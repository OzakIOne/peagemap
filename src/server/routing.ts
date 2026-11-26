import { createServerFn } from "@tanstack/solid-start";
import { z } from "zod";
import type { PlaceSuggestion, RouteGeometry } from "~/domain/toll-types";

const PHOTON_TIMEOUT_MS = 5_000;
const ROUTING_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 250;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class BoundedTtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }
}

const routeCache = new BoundedTtlCache<RouteGeometry | null>();
const geocodeCache = new BoundedTtlCache<PlaceSuggestion[]>();

const pointsCacheKey = (prefix: string, points: Array<{ lon: number; lat: number }>): string =>
  `${prefix}:${points.map((p) => `${p.lon.toFixed(4)},${p.lat.toFixed(4)}`).join(";")}`;

const GeocodeInputSchema = z.object({
  query: z.string().trim().min(2).max(120),
});

const PhotonFeatureSchema = z.object({
  geometry: z.object({
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: z.object({
    osm_id: z.number().optional(),
    name: z.string().optional(),
    city: z.string().optional(),
    postcode: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    countrycode: z.string().optional(),
  }),
});

const PhotonResponseSchema = z.object({
  features: z.array(PhotonFeatureSchema),
});

const parsePhotonFeatures = (
  features: Array<z.infer<typeof PhotonFeatureSchema>>,
  fallbackLabel: string,
): PlaceSuggestion[] => {
  const seen = new Set<string>();
  const suggestions: PlaceSuggestion[] = [];

  for (let index = 0; index < features.length; index += 1) {
    const feature = features[index];
    if (!feature) continue;
    const props = feature.properties;
    const label = props.name ?? props.city ?? fallbackLabel;
    const subtitleParts = [
      props.city && props.city !== label ? props.city : undefined,
      props.postcode,
      props.state,
    ].filter((part): part is string => Boolean(part));
    const subtitle = subtitleParts.join(", ") || props.country || "France";
    const dedupeKey = `${label.toLowerCase()}|${subtitle.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    suggestions.push({
      id: `${props.osm_id ?? index}-${feature.geometry.coordinates[0].toFixed(4)}`,
      label,
      subtitle,
      lon: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
    });
  }

  return suggestions;
};

export const searchPlaces = createServerFn({ method: "GET" })
  .validator((input: unknown) => GeocodeInputSchema.parse(input))
  .handler(async ({ data }): Promise<PlaceSuggestion[]> => {
    const cacheKey = data.query.toLowerCase();
    const cached = geocodeCache.get(cacheKey);
    if (cached) return cached;

    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", data.query);
    url.searchParams.set("limit", "6");
    url.searchParams.set("lang", "fr");
    url.searchParams.set("lat", "46.603354");
    url.searchParams.set("lon", "1.888334");
    url.searchParams.set("bbox", "-5.5,41.2,9.8,51.2");

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "PeageMap/1.0 (https://github.com/OzakIOne/peagemap)",
      },
      signal: AbortSignal.timeout(PHOTON_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Geocoding failed with status ${response.status}`);
    }

    const parsed = PhotonResponseSchema.parse(await response.json());
    const suggestions = parsePhotonFeatures(parsed.features, data.query);
    geocodeCache.set(cacheKey, suggestions);
    return suggestions;
  });

const CoordinatePointSchema = z.object({
  lon: z.number(),
  lat: z.number(),
});

export const reverseGeocode = createServerFn({ method: "GET" })
  .validator((input: unknown) => CoordinatePointSchema.parse(input))
  .handler(async ({ data }): Promise<PlaceSuggestion> => {
    const fallback: PlaceSuggestion = {
      id: `pin-${data.lon.toFixed(4)}-${data.lat.toFixed(4)}`,
      label: `${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}`,
      subtitle: "Point sur la carte",
      lon: data.lon,
      lat: data.lat,
    };

    try {
      const url = new URL("https://photon.komoot.io/reverse");
      url.searchParams.set("lat", String(data.lat));
      url.searchParams.set("lon", String(data.lon));
      url.searchParams.set("lang", "fr");

      const response = await fetch(url.toString(), {
        headers: {
          "User-Agent": "PeageMap/1.0 (https://github.com/OzakIOne/peagemap)",
        },
        signal: AbortSignal.timeout(PHOTON_TIMEOUT_MS),
      });

      if (!response.ok) return fallback;
      const parsed = PhotonResponseSchema.safeParse(await response.json());
      if (!parsed.success) return fallback;
      const first = parsePhotonFeatures(parsed.data.features, fallback.label)[0];
      if (!first) return fallback;
      return {
        ...first,
        lon: data.lon,
        lat: data.lat,
      };
    } catch {
      return fallback;
    }
  });

const RouteRequestSchema = z.object({
  origin: CoordinatePointSchema,
  destination: CoordinatePointSchema,
  waypoints: z.array(CoordinatePointSchema).max(10).default([]),
});

const OsrmRouteSchema = z.object({
  distance: z.number(),
  duration: z.number(),
  geometry: z.object({
    coordinates: z.array(z.tuple([z.number(), z.number()])),
  }),
});

const OsrmResponseSchema = z.object({
  code: z.string(),
  routes: z.array(OsrmRouteSchema),
});

const fetchOsrmSingle = async (params: {
  points: Array<{ lon: number; lat: number }>;
  excludeToll: boolean;
}): Promise<RouteGeometry | null> => {
  const { points, excludeToll } = params;
  const cacheKey = pointsCacheKey(excludeToll ? "osrm-free" : "osrm-hw", points);
  const cached = routeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const coords = points.map((point) => `${point.lon},${point.lat}`).join(";");
    const url = new URL(`https://router.project-osrm.org/route/v1/driving/${coords}`);
    url.searchParams.set("overview", "full");
    url.searchParams.set("geometries", "geojson");
    if (excludeToll) {
      url.searchParams.set("exclude", "toll");
    }

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "PeageMap/1.0 (https://github.com/OzakIOne/peagemap)",
      },
      signal: AbortSignal.timeout(ROUTING_TIMEOUT_MS),
    });

    if (!response.ok) return null;
    const json: unknown = await response.json();
    const parsed = OsrmResponseSchema.safeParse(json);
    if (!parsed.success || parsed.data.code !== "Ok") return null;
    const best = parsed.data.routes[0];
    if (!best) return null;

    const result: RouteGeometry = {
      coordinates: best.geometry.coordinates,
      distanceMeters: best.distance,
      durationSeconds: best.duration,
    };
    routeCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
};

const ValhallaResponseSchema = z.object({
  trip: z.object({
    summary: z.object({
      length: z.number(),
      time: z.number(),
    }),
    legs: z.array(
      z.object({
        shape: z.string(),
      }),
    ),
  }),
});

export const decodePolyline6 = (encoded: string): Array<[number, number]> => {
  const coordinates: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push([lon / 1e6, lat / 1e6]);
  }

  return coordinates;
};

const fetchValhallaTollFree = async (params: {
  points: Array<{ lon: number; lat: number }>;
}): Promise<RouteGeometry | null> => {
  const { points } = params;
  const cacheKey = pointsCacheKey("valhalla-free", points);
  const cached = routeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch("https://valhalla1.openstreetmap.de/route", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "PeageMap/1.0 (https://github.com/OzakIOne/peagemap)",
      },
      body: JSON.stringify({
        locations: points.map((point) => ({ lat: point.lat, lon: point.lon })),
        costing: "auto",
        costing_options: {
          auto: {
            use_tolls: 0,
          },
        },
        directions_options: {
          units: "kilometers",
        },
      }),
      signal: AbortSignal.timeout(ROUTING_TIMEOUT_MS),
    });

    if (!response.ok) return null;
    const json: unknown = await response.json();
    const parsed = ValhallaResponseSchema.safeParse(json);
    if (!parsed.success) return null;

    const coordinates = parsed.data.trip.legs.flatMap((leg) => decodePolyline6(leg.shape));
    if (coordinates.length < 2) return null;

    const result: RouteGeometry = {
      coordinates,
      distanceMeters: parsed.data.trip.summary.length * 1000,
      durationSeconds: parsed.data.trip.summary.time,
    };
    routeCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
};

export interface DualRouteResponse {
  highway: RouteGeometry;
  tollFree: RouteGeometry | null;
}

export const computeHighwayRoute = createServerFn({ method: "GET" })
  .validator((input: unknown) => RouteRequestSchema.parse(input))
  .handler(async ({ data }): Promise<RouteGeometry> => {
    const points = [data.origin, ...data.waypoints, data.destination];
    const highway = await fetchOsrmSingle({ points, excludeToll: false });
    if (!highway) {
      throw new Error("Impossible de calculer l’itinéraire OSRM pour ces points.");
    }
    return highway;
  });

export const computeTollFreeRoute = createServerFn({ method: "GET" })
  .validator((input: unknown) => RouteRequestSchema.parse(input))
  .handler(async ({ data }): Promise<RouteGeometry | null> => {
    const points = [data.origin, ...data.waypoints, data.destination];
    const valhalla = await fetchValhallaTollFree({ points });
    if (valhalla) return valhalla;
    return fetchOsrmSingle({ points, excludeToll: true });
  });

export const computeDualRoutes = createServerFn({ method: "GET" })
  .validator((input: unknown) => RouteRequestSchema.parse(input))
  .handler(async ({ data }): Promise<DualRouteResponse> => {
    const points = [data.origin, ...data.waypoints, data.destination];
    const [highway, tollFree] = await Promise.all([
      fetchOsrmSingle({ points, excludeToll: false }),
      fetchValhallaTollFree({ points }),
    ]);

    if (!highway) {
      throw new Error("Impossible de calculer l’itinéraire OSRM pour ces points.");
    }

    return {
      highway,
      tollFree,
    };
  });

const BypassSegmentRequestSchema = z.object({
  from: CoordinatePointSchema,
  to: CoordinatePointSchema,
});

export const computeBypassSegment = createServerFn({ method: "GET" })
  .validator((input: unknown) => BypassSegmentRequestSchema.parse(input))
  .handler(async ({ data }): Promise<RouteGeometry | null> => {
    const points = [data.from, data.to];
    const valhalla = await fetchValhallaTollFree({ points });
    if (valhalla) return valhalla;
    return fetchOsrmSingle({ points, excludeToll: true });
  });
