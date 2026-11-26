import { createServerFn } from "@tanstack/solid-start";
import { z } from "zod";
import type { PlaceSuggestion, RouteGeometry } from "~/domain/toll-types";

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

export const searchPlaces = createServerFn({ method: "GET" })
  .validator((input: unknown) => GeocodeInputSchema.parse(input))
  .handler(async ({ data }): Promise<PlaceSuggestion[]> => {
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
    });

    if (!response.ok) {
      throw new Error(`Geocoding failed with status ${response.status}`);
    }

    const parsed = PhotonResponseSchema.parse(await response.json());
    const seen = new Set<string>();
    const suggestions: PlaceSuggestion[] = [];

    for (let index = 0; index < parsed.features.length; index += 1) {
      const feature = parsed.features[index];
      if (!feature) continue;
      const props = feature.properties;
      const label = props.name ?? props.city ?? data.query;
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
  });

const CoordinatePointSchema = z.object({
  lon: z.number(),
  lat: z.number(),
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
  });

  if (!response.ok) return null;
  const json: unknown = await response.json();
  const parsed = OsrmResponseSchema.safeParse(json);
  if (!parsed.success || parsed.data.code !== "Ok") return null;
  const best = parsed.data.routes[0];
  if (!best) return null;

  return {
    coordinates: best.geometry.coordinates,
    distanceMeters: best.distance,
    durationSeconds: best.duration,
  };
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

const decodePolyline6 = (encoded: string): Array<[number, number]> => {
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
    });

    if (!response.ok) return null;
    const json: unknown = await response.json();
    const parsed = ValhallaResponseSchema.safeParse(json);
    if (!parsed.success) return null;

    const coordinates = parsed.data.trip.legs.flatMap((leg) => decodePolyline6(leg.shape));
    if (coordinates.length < 2) return null;

    return {
      coordinates,
      distanceMeters: parsed.data.trip.summary.length * 1000,
      durationSeconds: parsed.data.trip.summary.time,
    };
  } catch {
    return null;
  }
};

export interface DualRouteResponse {
  highway: RouteGeometry;
  tollFree: RouteGeometry | null;
}

export const computeDualRoutes = createServerFn({ method: "GET" })
  .validator((input: unknown) => RouteRequestSchema.parse(input))
  .handler(async ({ data }): Promise<DualRouteResponse> => {
    const points = [data.origin, ...data.waypoints, data.destination];
    const [highway, tollFree] = await Promise.all([
      fetchOsrmSingle({
        points,
        excludeToll: false,
      }),
      fetchValhallaTollFree({
        points,
      }),
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
