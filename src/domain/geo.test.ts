import { describe, expect, it } from "vitest";
import {
  buildCumulativeDistancesKm,
  findCoordIndexAtDistanceOffset,
  haversineKm,
  projectPointToRoute,
  samplePointsAlongPolyline,
} from "./geo";

describe("geo", () => {
  const straightLine: Array<[number, number]> = [
    [2.0, 48.0],
    [2.0, 48.1],
    [2.0, 48.2],
    [2.0, 48.3],
    [2.0, 48.4],
  ];

  it("computes cumulative distances and projects midpoints accurately", () => {
    const cumulative = buildCumulativeDistancesKm(straightLine);
    expect(cumulative).toHaveLength(5);
    expect(cumulative[0]).toBe(0);
    expect(cumulative[4]).toBeGreaterThan(40);

    const proj = projectPointToRoute({
      lat: 48.25,
      lon: 2.0,
      coordinates: straightLine,
      cumulativeDistancesKm: cumulative,
    });
    expect(proj.distanceFromRouteKm).toBeLessThan(0.05);
    expect(proj.distanceAlongRouteKm).toBeCloseTo(haversineKm(48.0, 2.0, 48.25, 2.0), 0);
  });

  it("handles empty routes gracefully", () => {
    const proj = projectPointToRoute({
      lat: 48.0,
      lon: 2.0,
      coordinates: [],
      cumulativeDistancesKm: [],
    });
    expect(proj.distanceFromRouteKm).toBe(Number.POSITIVE_INFINITY);
    expect(proj.coordIndex).toBe(0);
  });

  it("finds coord indices by real distance offset forward and backward", () => {
    const cumulative = buildCumulativeDistancesKm(straightLine);
    const forward = findCoordIndexAtDistanceOffset({
      cumulativeDistancesKm: cumulative,
      originIndex: 2,
      deltaKm: 12,
    });
    const backward = findCoordIndexAtDistanceOffset({
      cumulativeDistancesKm: cumulative,
      originIndex: 2,
      deltaKm: -12,
    });
    expect(forward).toBe(4);
    expect(backward).toBe(0);
  });

  it("samples points by distance fractions along a polyline", () => {
    const sampled = samplePointsAlongPolyline({
      coordinates: straightLine,
      fractions: [0.25, 0.5, 0.75],
    });
    expect(sampled).toHaveLength(3);
    expect(sampled[0]?.[1]).toBeCloseTo(48.1, 1);
    expect(sampled[1]?.[1]).toBeCloseTo(48.2, 1);
    expect(sampled[2]?.[1]).toBeCloseTo(48.3, 1);
  });
});
