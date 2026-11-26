import { describe, expect, it } from "vitest";
import type {
  BypassDetour,
  MatchedTollUnit,
  PlaceSuggestion,
  PricedTollSection,
  RouteGeometry,
} from "~/domain/toll-types";
import {
  buildAppleMapsUrl,
  buildCopilotChecklistText,
  buildGoogleMapsUrl,
  buildGpxContent,
  buildGpxFilename,
  buildWazeUrl,
  collectOrderedExportWaypoints,
  getExportWarnings,
} from "./route-export";

const paris: PlaceSuggestion = {
  id: "paris",
  label: "Paris",
  subtitle: "Île-de-France",
  lon: 2.3522,
  lat: 48.8566,
};

const dijon: PlaceSuggestion = {
  id: "dijon",
  label: "Dijon",
  subtitle: "Bourgogne",
  lon: 5.0415,
  lat: 47.322,
};

const lyon: PlaceSuggestion = {
  id: "lyon",
  label: "Lyon",
  subtitle: "Auvergne-Rhône-Alpes",
  lon: 4.8357,
  lat: 45.764,
};

const sampleRoute: RouteGeometry = {
  coordinates: [
    [2.3522, 48.8566],
    [3.5, 48.1],
    [5.0415, 47.322],
    [4.9, 46.5],
    [4.8357, 45.764],
  ],
  distanceMeters: 465_000,
  durationSeconds: 16_200,
};

const sampleUnits: MatchedTollUnit[] = [
  {
    kind: "closed",
    id: "aprr-run",
    networkId: "aprr",
    concessionaire: "APRR",
    highways: ["A6"],
    plazas: [
      {
        plaza: {
          id: "fleury",
          name: "Fleury",
          highway: "A6",
          concessionaire: "APRR",
          networkId: "aprr",
          system: "closed",
          lat: 48.45,
          lon: 2.55,
        },
        distanceFromRouteKm: 0.2,
        distanceAlongRouteKm: 50,
        routeCoordIndex: 0,
      },
      {
        plaza: {
          id: "auxerre",
          name: "Auxerre Nord",
          highway: "A6",
          concessionaire: "APRR",
          networkId: "aprr",
          system: "closed",
          lat: 47.82,
          lon: 3.57,
        },
        distanceFromRouteKm: 0.3,
        distanceAlongRouteKm: 150,
        routeCoordIndex: 1,
      },
      {
        plaza: {
          id: "macon",
          name: "Mâcon Sud",
          highway: "A6",
          concessionaire: "APRR",
          networkId: "aprr",
          system: "closed",
          lat: 46.28,
          lon: 4.81,
        },
        distanceFromRouteKm: 0.2,
        distanceAlongRouteKm: 390,
        routeCoordIndex: 3,
      },
      {
        plaza: {
          id: "villefranche",
          name: "Villefranche",
          highway: "A6",
          concessionaire: "APRR",
          networkId: "aprr",
          system: "closed",
          lat: 45.98,
          lon: 4.72,
        },
        distanceFromRouteKm: 0.1,
        distanceAlongRouteKm: 430,
        routeCoordIndex: 4,
      },
    ],
  },
];

describe("route-export", () => {
  it("orders stops and active split plazas along the route", () => {
    const waypoints = collectOrderedExportWaypoints({
      origin: paris,
      destination: lyon,
      stops: [dijon],
      route: sampleRoute,
      units: sampleUnits,
      splitPlazaIds: new Set(["auxerre", "macon"]),
      avoidTolls: false,
    });

    expect(waypoints.map((w) => w.kind)).toEqual(["split", "stop", "split"]);
    expect(waypoints[0]?.name).toContain("Auxerre Nord");
    expect(waypoints[1]?.name).toBe("Dijon");
    expect(waypoints[2]?.name).toContain("Mâcon Sud");
  });

  it("builds valid Google Maps, Apple Maps, and Waze URLs", () => {
    const input = {
      origin: paris,
      destination: lyon,
      stops: [dijon],
      route: sampleRoute,
      units: sampleUnits,
      splitPlazaIds: new Set(["macon"]),
      avoidTolls: false,
    };

    const gmaps = new URL(buildGoogleMapsUrl(input));
    expect(gmaps.origin + gmaps.pathname).toBe("https://www.google.com/maps/dir/");
    expect(gmaps.searchParams.get("origin")).toBe("48.856600,2.352200");
    expect(gmaps.searchParams.get("destination")).toBe("45.764000,4.835700");
    expect(gmaps.searchParams.get("waypoints")).toBe("47.322000,5.041500|46.280000,4.810000");
    expect(gmaps.searchParams.get("avoid")).toBeNull();

    const apple = buildAppleMapsUrl(input);
    expect(apple).toBe(
      "https://maps.apple.com/?saddr=48.856600,2.352200&daddr=47.322000,5.041500+to:46.280000,4.810000+to:45.764000,4.835700&dirflg=d",
    );

    const waze = new URL(buildWazeUrl(input));
    expect(waze.searchParams.get("ll")).toBe("45.764000,4.835700");
    expect(waze.searchParams.get("navigate")).toBe("yes");
  });

  it("adds avoid=tolls and skips split plazas when exporting toll-free", () => {
    const gmaps = new URL(
      buildGoogleMapsUrl({
        origin: paris,
        destination: lyon,
        stops: [dijon],
        route: sampleRoute,
        units: sampleUnits,
        splitPlazaIds: new Set(["macon"]),
        avoidTolls: true,
      }),
    );

    expect(gmaps.searchParams.get("avoid")).toBe("tolls");
    expect(gmaps.searchParams.get("waypoints")).toBe("47.322000,5.041500");
  });

  it("generates valid GPX 1.1 XML with waypoints and trackpoints", () => {
    const gpx = buildGpxContent({
      origin: paris,
      destination: lyon,
      stops: [dijon],
      route: sampleRoute,
      units: sampleUnits,
      splitPlazaIds: new Set(["macon"]),
      avoidTolls: false,
    });

    expect(gpx).toContain('<gpx version="1.1" creator="PeageMap"');
    expect(gpx).toContain("<name>Départ : Paris</name>");
    expect(gpx).toContain("<name>Étape 1 : Dijon</name>");
    expect(gpx).toContain("<name>Sortie : Péage Mâcon Sud (A6)</name>");
    expect(gpx).toContain("<name>Arrivée : Lyon</name>");
    expect(gpx).toContain('<trkpt lat="48.856600" lon="2.352200" />');
    expect(gpx).toContain('<trkpt lat="45.764000" lon="4.835700" />');
    expect(buildGpxFilename({ originLabel: "Château-Thierry", destinationLabel: "Mâcon" })).toBe(
      "peagemap-chateau-thierry-macon.gpx",
    );
  });

  it("samples multiple waypoints along long bypass detours, stitches exact GPX spans, and reports warnings", () => {
    const firstUnit = sampleUnits[0];
    if (!firstUnit || firstUnit.kind !== "closed") return;
    const fromPlaza = firstUnit.plazas[1]!;
    const toPlaza = firstUnit.plazas[2]!;

    const bypassedSection: PricedTollSection = {
      id: "sec:aprr-run:auxerre->macon",
      runId: "aprr-run",
      kind: "closed",
      concessionaire: "APRR",
      highway: "A6",
      fromPlaza,
      toPlaza,
      distanceKm: 240,
      basePriceEur: 20,
      effectivePriceEur: 0,
      isBypassed: true,
      bypassRole: "manual",
      isSplitStart: false,
      isSplitEnd: false,
      isFreeFlow: false,
      bypassExtraMinutes: 45,
      coordinates: sampleRoute.coordinates.slice(1, 4),
    };

    const detour: BypassDetour = {
      sectionId: bypassedSection.id,
      coordinates: [
        [3.57, 47.82],
        [4.1, 47.4],
        [4.5, 46.9],
        [4.81, 46.28],
      ],
      distanceMeters: 260_000,
      durationSeconds: 12_000,
      extraMinutes: 40,
      extraDistanceKm: 20,
      startCoordIndex: 1,
      endCoordIndex: 3,
    };

    const inputWithDetour = {
      origin: paris,
      destination: lyon,
      stops: [],
      route: sampleRoute,
      units: sampleUnits,
      sections: [bypassedSection],
      bypassDetours: { [bypassedSection.id]: detour },
      splitPlazaIds: new Set<string>(),
      avoidTolls: false,
    };

    const wps = collectOrderedExportWaypoints(inputWithDetour);
    expect(wps.filter((w) => w.kind === "bypass")).toHaveLength(3);
    expect(getExportWarnings(inputWithDetour)).toEqual([]);

    const missingDetourWarnings = getExportWarnings({
      ...inputWithDetour,
      bypassDetours: {},
    });
    expect(missingDetourWarnings[0]).toContain("1 contournement");

    const gpx = buildGpxContent(inputWithDetour);
    expect(gpx).toContain('<trkpt lat="47.400000" lon="4.100000" />');
    expect(gpx).not.toContain('<trkpt lat="47.322000" lon="5.041500" />');

    const checklist = buildCopilotChecklistText(inputWithDetour);
    expect(checklist).toContain("Éviter par nationale : Auxerre Nord → Mâcon Sud (A6)");
  });
});
