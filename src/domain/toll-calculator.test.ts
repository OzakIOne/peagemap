import { describe, expect, it } from "vitest";
import {
  SPLIT_EXTRA_MINUTES,
  estimateFuelCostEur,
  evaluateRouteTolls,
  optimizeTollSplits,
} from "./toll-calculator";
import type { TollDataset } from "./toll-types";

const sampleDataset: TollDataset = {
  version: "test-2026",
  updatedAt: "2026-02-01",
  sources: [],
  plazas: [
    {
      id: "aprr:fleury",
      name: "Fleury-en-Bière",
      highway: "A6",
      concessionaire: "APRR",
      networkId: "aprr-area",
      system: "closed",
      lat: 48.445,
      lon: 2.55,
    },
    {
      id: "aprr:auxerre-sud",
      name: "Auxerre-Sud",
      exitNumber: "20",
      highway: "A6",
      concessionaire: "APRR",
      networkId: "aprr-area",
      system: "closed",
      lat: 47.75,
      lon: 3.63,
    },
    {
      id: "aprr:beaune",
      name: "Beaune",
      exitNumber: "24",
      highway: "A6",
      concessionaire: "APRR",
      networkId: "aprr-area",
      system: "closed",
      lat: 47.02,
      lon: 4.86,
    },
    {
      id: "aprr:villefranche",
      name: "Villefranche-Limas",
      highway: "A6",
      concessionaire: "APRR",
      networkId: "aprr-area",
      system: "closed",
      lat: 45.97,
      lon: 4.74,
    },
    {
      id: "asf:vienne",
      name: "Vienne",
      highway: "A7",
      concessionaire: "ASF",
      networkId: "asf-open",
      system: "open",
      lat: 45.52,
      lon: 4.87,
    },
  ],
  tariffs: {
    "aprr:fleury|aprr:villefranche": [37.9, 58.6, 22.7],
    "aprr:fleury|aprr:auxerre-sud": [12.8, 19.8, 7.7],
    "aprr:auxerre-sud|aprr:villefranche": [22.4, 34.6, 13.4],
    "aprr:fleury|aprr:beaune": [23.6, 36.5, 14.2],
    "aprr:beaune|aprr:villefranche": [11.9, 18.4, 7.1],
    "aprr:auxerre-sud|aprr:beaune": [10.1, 15.6, 6.0],
    "asf:vienne|asf:vienne": [3.4, 5.2, 2.0],
  },
};

const sampleRoute: Array<[number, number]> = [
  [2.55, 48.45],
  [3.63, 47.75],
  [4.86, 47.02],
  [4.74, 45.97],
  [4.87, 45.52],
];

describe("toll-calculator", () => {
  it("computes direct toll for closed run + open barrier", () => {
    const result = evaluateRouteTolls({
      dataset: sampleDataset,
      coordinates: sampleRoute,
      vehicleClass: "c1",
      splitPlazaIds: new Set(),
      bypassedSectionIds: new Set(),
    });

    expect(result.units).toHaveLength(2);
    expect(result.sections).toHaveLength(2);
    expect(result.directTollEur).toBe(41.3);
    expect(result.currentTollEur).toBe(41.3);
    expect(result.savingsEur).toBe(0);
  });

  it("recalculates each section price live when user splits at Auxerre-Sud", () => {
    const result = evaluateRouteTolls({
      dataset: sampleDataset,
      coordinates: sampleRoute,
      vehicleClass: "c1",
      splitPlazaIds: new Set(["aprr:auxerre-sud"]),
      bypassedSectionIds: new Set(),
    });

    expect(result.sections).toHaveLength(3);
    expect(result.sections[0]?.effectivePriceEur).toBe(12.8);
    expect(result.sections[1]?.effectivePriceEur).toBe(22.4);
    expect(result.sections[2]?.effectivePriceEur).toBe(3.4);
    expect(result.currentTollEur).toBe(38.6);
    expect(result.savingsEur).toBe(2.7);
    expect(result.addedMinutes).toBe(SPLIT_EXTRA_MINUTES);
  });

  it("supports bypassing a section and sets its toll to 0", () => {
    const direct = evaluateRouteTolls({
      dataset: sampleDataset,
      coordinates: sampleRoute,
      vehicleClass: "c1",
      splitPlazaIds: new Set(["aprr:auxerre-sud"]),
      bypassedSectionIds: new Set(),
    });

    const firstSectionId = direct.sections[0]?.id ?? "";
    const bypassed = evaluateRouteTolls({
      dataset: sampleDataset,
      coordinates: sampleRoute,
      vehicleClass: "c1",
      splitPlazaIds: new Set(["aprr:auxerre-sud"]),
      bypassedSectionIds: new Set([firstSectionId]),
    });

    expect(bypassed.sections[0]?.isBypassed).toBe(true);
    expect(bypassed.sections[0]?.effectivePriceEur).toBe(0);
    expect(bypassed.currentTollEur).toBe(25.8);
    expect(bypassed.bypassCount).toBe(1);
  });

  it("finds optimal split combination via DP under time budget", () => {
    const base = evaluateRouteTolls({
      dataset: sampleDataset,
      coordinates: sampleRoute,
      vehicleClass: "c1",
      splitPlazaIds: new Set(),
      bypassedSectionIds: new Set(),
    });

    const oneSplit = optimizeTollSplits({
      dataset: sampleDataset,
      units: base.units,
      vehicleClass: "c1",
      maxAddedMinutes: 5,
    });

    expect(oneSplit.splitPlazaIds).toEqual(["aprr:auxerre-sud"]);
    expect(oneSplit.optimizedTollEur).toBe(38.6);
    expect(oneSplit.savingsEur).toBe(2.7);

    const twoSplits = optimizeTollSplits({
      dataset: sampleDataset,
      units: base.units,
      vehicleClass: "c1",
      maxAddedMinutes: 10,
    });

    expect(twoSplits.splitPlazaIds).toEqual(["aprr:auxerre-sud", "aprr:beaune"]);
    expect(twoSplits.optimizedTollEur).toBe(38.2);
    expect(twoSplits.savingsEur).toBe(3.1);
  });

  it("switches pricing accurately for vehicle classes c2 and c5", () => {
    const moto = evaluateRouteTolls({
      dataset: sampleDataset,
      coordinates: sampleRoute,
      vehicleClass: "c5",
      splitPlazaIds: new Set(),
      bypassedSectionIds: new Set(),
    });

    expect(moto.directTollEur).toBe(24.7);
    expect(
      estimateFuelCostEur({
        distanceKm: 500,
        litersPer100Km: 6.5,
        fuelPricePerLiterEur: 1.8,
      }),
    ).toBe(58.5);
  });
});
