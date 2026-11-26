import { z } from "zod";

export const VehicleClassSchema = z.enum(["c1", "c2", "c5"]);
export type VehicleClass = z.infer<typeof VehicleClassSchema>;

export const VEHICLE_CLASS_META: Record<
  VehicleClass,
  { label: string; shortLabel: string; description: string; defaultLitersPer100Km: number }
> = {
  c1: {
    label: "Classe 1 — Voiture",
    shortLabel: "Classe 1",
    description: "Véhicule léger (hauteur ≤ 2 m, PTAC ≤ 3,5 t)",
    defaultLitersPer100Km: 6.5,
  },
  c2: {
    label: "Classe 2 — Van / Camping-car",
    shortLabel: "Classe 2",
    description: "Véhicule intermédiaire (hauteur 2 à 3 m)",
    defaultLitersPer100Km: 9.2,
  },
  c5: {
    label: "Classe 5 — Moto",
    shortLabel: "Classe 5",
    description: "Moto, side-car, trike",
    defaultLitersPer100Km: 4.8,
  },
};

export const TollSystemSchema = z.enum(["closed", "open"]);
export type TollSystem = z.infer<typeof TollSystemSchema>;

export const TollPlazaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  exitNumber: z.string().optional(),
  highway: z.string().min(1),
  concessionaire: z.string().min(1),
  networkId: z.string().min(1),
  system: TollSystemSchema,
  freeFlow: z.boolean().optional(),
  lat: z.number(),
  lon: z.number(),
});
export type TollPlaza = z.infer<typeof TollPlazaSchema>;

export const TariffTupleSchema = z.tuple([z.number(), z.number(), z.number()]);
export type TariffTuple = z.infer<typeof TariffTupleSchema>;

export const TollSourceSchema = z.object({
  concessionaire: z.string(),
  year: z.number(),
  url: z.string(),
  plazaCount: z.number(),
  tariffCount: z.number(),
});
export type TollSource = z.infer<typeof TollSourceSchema>;

export const TollDatasetSchema = z.object({
  version: z.string(),
  updatedAt: z.string(),
  sources: z.array(TollSourceSchema),
  plazas: z.array(TollPlazaSchema),
  tariffs: z.record(z.string(), TariffTupleSchema),
});
export type TollDataset = z.infer<typeof TollDatasetSchema>;

export interface LngLatPoint {
  lon: number;
  lat: number;
}

export interface PlaceSuggestion {
  id: string;
  label: string;
  subtitle: string;
  lon: number;
  lat: number;
}

export interface RouteGeometry {
  coordinates: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
}

export interface MatchedPlaza {
  plaza: TollPlaza;
  distanceFromRouteKm: number;
  distanceAlongRouteKm: number;
  routeCoordIndex: number;
}

export interface ClosedTollRun {
  kind: "closed";
  id: string;
  networkId: string;
  concessionaire: string;
  highways: string[];
  plazas: MatchedPlaza[];
}

export interface OpenTollBarrier {
  kind: "open";
  id: string;
  networkId: string;
  concessionaire: string;
  highway: string;
  plaza: MatchedPlaza;
}

export type MatchedTollUnit = ClosedTollRun | OpenTollBarrier;

export interface PricedTollSection {
  id: string;
  runId: string;
  kind: "closed" | "open";
  concessionaire: string;
  highway: string;
  fromPlaza: MatchedPlaza;
  toPlaza: MatchedPlaza;
  distanceKm: number;
  basePriceEur: number | null;
  effectivePriceEur: number;
  isBypassed: boolean;
  bypassRole?: "manual" | "before-entry" | "after-exit";
  isSplitStart: boolean;
  isSplitEnd: boolean;
  isFreeFlow: boolean;
  freeFlowPaymentUrl?: string;
  bypassExtraMinutes: number;
  coordinates: Array<[number, number]>;
}

export interface RunEntryExitOverride {
  entryPlazaId?: string;
  exitPlazaId?: string;
}

export interface PricedRouteSummary {
  units: MatchedTollUnit[];
  sections: PricedTollSection[];
  directTollEur: number;
  currentTollEur: number;
  savingsEur: number;
  savingsPercent: number;
  splitCount: number;
  bypassCount: number;
  addedMinutes: number;
  addedDistanceKm: number;
  unknownSectionCount: number;
}

export interface OptimizationResult {
  splitPlazaIds: string[];
  directTollEur: number;
  optimizedTollEur: number;
  savingsEur: number;
  savingsPercent: number;
  addedMinutes: number;
  savingsPerHourEur: number;
}

export interface BypassDetour {
  sectionId: string;
  coordinates: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
  extraMinutes: number;
  extraDistanceKm: number;
  startCoordIndex?: number;
  endCoordIndex?: number;
}

export type BypassDetourState =
  | { status: "loading" }
  | { status: "ready"; detour: BypassDetour }
  | { status: "error"; message: string };

export type OptimizationProfile = "fast" | "balanced" | "eco" | "free";

export interface SplitCandidateInsight {
  matched: MatchedPlaza;
  isActive: boolean;
  savingsEur: number | null;
  savingsPerHourEur: number | null;
}
