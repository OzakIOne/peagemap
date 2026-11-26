import { buildCumulativeDistancesKm, projectPointToRoute } from "~/domain/geo";
import type { MatchedTollUnit, PlaceSuggestion, RouteGeometry } from "~/domain/toll-types";

export interface ExportWaypoint {
  name: string;
  lat: number;
  lon: number;
  kind: "stop" | "split";
}

export interface RouteExportInput {
  origin: PlaceSuggestion;
  destination: PlaceSuggestion;
  stops: PlaceSuggestion[];
  route: RouteGeometry;
  units: MatchedTollUnit[];
  splitPlazaIds: ReadonlySet<string>;
  avoidTolls: boolean;
}

const GOOGLE_MAPS_MAX_WAYPOINTS = 9;

const formatCoord = (value: number): string => value.toFixed(6);

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const slugify = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "trajet";

export const collectOrderedExportWaypoints = (input: RouteExportInput): ExportWaypoint[] => {
  if (input.avoidTolls) {
    return input.stops.map((stop) => ({
      name: stop.label,
      lat: stop.lat,
      lon: stop.lon,
      kind: "stop",
    }));
  }

  const cumulativeKm = buildCumulativeDistancesKm(input.route.coordinates);
  const items: Array<ExportWaypoint & { distanceAlongRouteKm: number }> = [];

  for (const stop of input.stops) {
    const projection = projectPointToRoute({
      lat: stop.lat,
      lon: stop.lon,
      coordinates: input.route.coordinates,
      cumulativeDistancesKm: cumulativeKm,
    });
    items.push({
      name: stop.label,
      lat: stop.lat,
      lon: stop.lon,
      kind: "stop",
      distanceAlongRouteKm: projection.distanceAlongRouteKm,
    });
  }

  for (const unit of input.units) {
    if (unit.kind !== "closed") continue;
    for (let i = 1; i < unit.plazas.length - 1; i += 1) {
      const matched = unit.plazas[i];
      if (!matched || !input.splitPlazaIds.has(matched.plaza.id)) continue;
      items.push({
        name: `Péage ${matched.plaza.name} (${matched.plaza.highway})`,
        lat: matched.plaza.lat,
        lon: matched.plaza.lon,
        kind: "split",
        distanceAlongRouteKm: matched.distanceAlongRouteKm,
      });
    }
  }

  items.sort((a, b) => a.distanceAlongRouteKm - b.distanceAlongRouteKm);

  return items.map(({ name, lat, lon, kind }) => ({ name, lat, lon, kind }));
};

const capWaypoints = (waypoints: ExportWaypoint[], limit: number): ExportWaypoint[] => {
  if (waypoints.length <= limit) return waypoints;
  const keptIndices = new Set<number>();
  for (let i = 0; i < waypoints.length && keptIndices.size < limit; i += 1) {
    if (waypoints[i]?.kind === "stop") {
      keptIndices.add(i);
    }
  }
  for (let i = 0; i < waypoints.length && keptIndices.size < limit; i += 1) {
    if (!keptIndices.has(i)) {
      keptIndices.add(i);
    }
  }
  return waypoints.filter((_, index) => keptIndices.has(index));
};

export const buildGoogleMapsUrl = (input: RouteExportInput): string => {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set(
    "origin",
    `${formatCoord(input.origin.lat)},${formatCoord(input.origin.lon)}`,
  );
  url.searchParams.set(
    "destination",
    `${formatCoord(input.destination.lat)},${formatCoord(input.destination.lon)}`,
  );
  url.searchParams.set("travelmode", "driving");

  const waypoints = capWaypoints(collectOrderedExportWaypoints(input), GOOGLE_MAPS_MAX_WAYPOINTS);
  if (waypoints.length > 0) {
    url.searchParams.set(
      "waypoints",
      waypoints.map((wp) => `${formatCoord(wp.lat)},${formatCoord(wp.lon)}`).join("|"),
    );
  }

  if (input.avoidTolls) {
    url.searchParams.set("avoid", "tolls");
  }

  return url.toString();
};

export const buildAppleMapsUrl = (input: RouteExportInput): string => {
  const waypoints = collectOrderedExportWaypoints(input);
  const saddr = `${formatCoord(input.origin.lat)},${formatCoord(input.origin.lon)}`;
  const daddrStops = [
    ...waypoints.map((wp) => `${formatCoord(wp.lat)},${formatCoord(wp.lon)}`),
    `${formatCoord(input.destination.lat)},${formatCoord(input.destination.lon)}`,
  ];
  return `https://maps.apple.com/?saddr=${saddr}&daddr=${daddrStops.join("+to:")}&dirflg=d`;
};

export const buildWazeUrl = (input: RouteExportInput): string => {
  const url = new URL("https://waze.com/ul");
  url.searchParams.set(
    "ll",
    `${formatCoord(input.destination.lat)},${formatCoord(input.destination.lon)}`,
  );
  url.searchParams.set("navigate", "yes");
  return url.toString();
};

export const buildGpxFilename = (params: {
  originLabel: string;
  destinationLabel: string;
}): string => `peagemap-${slugify(params.originLabel)}-${slugify(params.destinationLabel)}.gpx`;

export const buildGpxContent = (input: RouteExportInput): string => {
  const waypoints = collectOrderedExportWaypoints(input);
  const routeTitle = `${input.origin.label} → ${input.destination.label}`;

  const wptLines: string[] = [
    `  <wpt lat="${formatCoord(input.origin.lat)}" lon="${formatCoord(input.origin.lon)}"><name>${escapeXml(`Départ : ${input.origin.label}`)}</name></wpt>`,
  ];

  let stopNumber = 0;
  for (const wp of waypoints) {
    if (wp.kind === "stop") {
      stopNumber += 1;
      wptLines.push(
        `  <wpt lat="${formatCoord(wp.lat)}" lon="${formatCoord(wp.lon)}"><name>${escapeXml(`Étape ${stopNumber} : ${wp.name}`)}</name></wpt>`,
      );
    } else {
      wptLines.push(
        `  <wpt lat="${formatCoord(wp.lat)}" lon="${formatCoord(wp.lon)}"><name>${escapeXml(`Sortie : ${wp.name}`)}</name></wpt>`,
      );
    }
  }

  wptLines.push(
    `  <wpt lat="${formatCoord(input.destination.lat)}" lon="${formatCoord(input.destination.lon)}"><name>${escapeXml(`Arrivée : ${input.destination.label}`)}</name></wpt>`,
  );

  const trkptLines = input.route.coordinates.map(
    ([lon, lat]) => `      <trkpt lat="${formatCoord(lat)}" lon="${formatCoord(lon)}" />`,
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="PeageMap" xmlns="http://www.topografix.com/GPX/1/1">',
    "  <metadata>",
    `    <name>${escapeXml(routeTitle)}</name>`,
    "  </metadata>",
    ...wptLines,
    "  <trk>",
    `    <name>${escapeXml(routeTitle)}</name>`,
    "    <trkseg>",
    ...trkptLines,
    "    </trkseg>",
    "  </trk>",
    "</gpx>",
    "",
  ].join("\n");
};

export const downloadGpxFile = (input: RouteExportInput): void => {
  const xml = buildGpxContent(input);
  const blob = new Blob([xml], { type: "application/gpx+xml;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = buildGpxFilename({
    originLabel: input.origin.label,
    destinationLabel: input.destination.label,
  });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
};
