import { buildCumulativeDistancesKm, projectPointToRoute, sliceRouteCoordinates } from "./geo";
import type {
  BypassDetourState,
  ClosedTollRun,
  MatchedPlaza,
  MatchedTollUnit,
  OptimizationProfile,
  OptimizationResult,
  PricedRouteSummary,
  PricedTollSection,
  RunEntryExitOverride,
  SplitCandidateInsight,
  TollDataset,
  TollPlaza,
  VehicleClass,
} from "./toll-types";

export const SPLIT_EXTRA_MINUTES = 4;
export const TELEPEAGE_SPLIT_EXTRA_MINUTES = 2;
export const SPLIT_EXTRA_KM = 0.8;
const DEFAULT_CORRIDOR_KM = 1.4;
const OPEN_BARRIER_CORRIDOR_KM = 0.65;
const MIN_OPEN_BARRIER_BYPASS_MINUTES = 5;

export const getSplitExtraMinutes = (hasTelepeage: boolean): number =>
  hasTelepeage ? TELEPEAGE_SPLIT_EXTRA_MINUTES : SPLIT_EXTRA_MINUTES;

export const isFreeFlowPlaza = (plaza: TollPlaza): boolean => {
  if (plaza.freeFlow === true) return true;
  const hw = plaza.highway.toUpperCase();
  const net = plaza.networkId.toLowerCase();
  const name = plaza.name.toLowerCase();
  if (hw === "A79" || net.includes("aliae")) return true;
  if (hw === "A13" || hw === "A14") return true;
  if (hw === "A4" && name.includes("boulay")) return true;
  return false;
};

export const getFreeFlowPaymentUrl = (plaza: TollPlaza): string | undefined => {
  if (!isFreeFlowPlaza(plaza)) return undefined;
  const hw = plaza.highway.toUpperCase();
  const net = plaza.networkId.toLowerCase();
  if (hw === "A79" || net.includes("aliae")) return "https://paiement.aliae.com";
  if (hw === "A13" || hw === "A14" || hw === "A4") return "https://www.sanef.com/fr/flux-libre";
  return "https://www.ecologie.gouv.fr/peage-flux-libre";
};

const vehicleClassIndex = (vehicleClass: VehicleClass): 0 | 1 | 2 => {
  if (vehicleClass === "c1") return 0;
  if (vehicleClass === "c2") return 1;
  return 2;
};

const roundEur = (value: number): number => Math.round(value * 100) / 100;

export const lookupTariffEur = (params: {
  dataset: TollDataset;
  fromId: string;
  toId: string;
  vehicleClass: VehicleClass;
}): number | null => {
  const { dataset, fromId, toId, vehicleClass } = params;
  const idx = vehicleClassIndex(vehicleClass);
  const direct = dataset.tariffs[`${fromId}|${toId}`];
  if (direct) return direct[idx];
  const reverse = dataset.tariffs[`${toId}|${fromId}`];
  if (reverse) return reverse[idx];
  return null;
};

const boundingBoxForRoute = (coordinates: Array<[number, number]>, paddingDeg: number) => {
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const coord of coordinates) {
    const [lon, lat] = coord;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  return {
    minLon: minLon - paddingDeg,
    maxLon: maxLon + paddingDeg,
    minLat: minLat - paddingDeg,
    maxLat: maxLat + paddingDeg,
  };
};

export const matchPlazasToRoute = (params: {
  coordinates: Array<[number, number]>;
  plazas: TollPlaza[];
  corridorKm?: number;
}): MatchedPlaza[] => {
  const { coordinates, plazas, corridorKm = DEFAULT_CORRIDOR_KM } = params;
  if (coordinates.length < 2) return [];

  const bbox = boundingBoxForRoute(coordinates, corridorKm / 70 + 0.05);
  const cumulativeDistancesKm = buildCumulativeDistancesKm(coordinates);
  const matched: MatchedPlaza[] = [];

  for (const plaza of plazas) {
    if (
      plaza.lon < bbox.minLon ||
      plaza.lon > bbox.maxLon ||
      plaza.lat < bbox.minLat ||
      plaza.lat > bbox.maxLat
    ) {
      continue;
    }

    const projection = projectPointToRoute({
      lat: plaza.lat,
      lon: plaza.lon,
      coordinates,
      cumulativeDistancesKm,
    });

    const effectiveCorridorKm =
      params.corridorKm !== undefined
        ? corridorKm
        : plaza.system === "open"
          ? OPEN_BARRIER_CORRIDOR_KM
          : corridorKm;

    if (projection.distanceFromRouteKm <= effectiveCorridorKm) {
      matched.push({
        plaza,
        distanceFromRouteKm: projection.distanceFromRouteKm,
        distanceAlongRouteKm: projection.distanceAlongRouteKm,
        routeCoordIndex: projection.coordIndex,
      });
    }
  }

  matched.sort((a, b) => a.distanceAlongRouteKm - b.distanceAlongRouteKm);

  const deduped: MatchedPlaza[] = [];
  for (const item of matched) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.plaza.networkId === item.plaza.networkId && prev.plaza.id === item.plaza.id) {
      continue;
    }
    deduped.push(item);
  }

  return deduped;
};

export const groupMatchedPlazasIntoUnits = (matchedPlazas: MatchedPlaza[]): MatchedTollUnit[] => {
  const units: MatchedTollUnit[] = [];
  let currentClosed: MatchedPlaza[] = [];

  const flushClosed = () => {
    if (currentClosed.length >= 2) {
      const first = currentClosed[0];
      const last = currentClosed[currentClosed.length - 1];
      if (first && last) {
        const highways = Array.from(new Set(currentClosed.map((m) => m.plaza.highway)));
        units.push({
          kind: "closed",
          id: `run:${first.plaza.networkId}:${first.plaza.id}:${last.plaza.id}`,
          networkId: first.plaza.networkId,
          concessionaire: first.plaza.concessionaire,
          highways,
          plazas: currentClosed,
        });
      }
    }
    currentClosed = [];
  };

  for (let index = 0; index < matchedPlazas.length; index += 1) {
    const item = matchedPlazas[index];
    if (!item) continue;

    if (item.plaza.system === "open") {
      if (currentClosed.length > 0) {
        const activeNetworkId = currentClosed[0]?.plaza.networkId;
        const activeHighways = new Set(currentClosed.map((m) => m.plaza.highway.toUpperCase()));
        const continuesSameClosedRun = matchedPlazas
          .slice(index + 1)
          .some(
            (later) => later.plaza.system === "closed" && later.plaza.networkId === activeNetworkId,
          );
        if (continuesSameClosedRun && !activeHighways.has(item.plaza.highway.toUpperCase())) {
          continue;
        }
        flushClosed();
      }
      units.push({
        kind: "open",
        id: `open:${item.plaza.id}:${units.length}`,
        networkId: item.plaza.networkId,
        concessionaire: item.plaza.concessionaire,
        highway: item.plaza.highway,
        plaza: item,
      });
      continue;
    }

    const prev = currentClosed[currentClosed.length - 1];
    if (prev && prev.plaza.networkId !== item.plaza.networkId) {
      flushClosed();
    }
    currentClosed.push(item);
  }

  flushClosed();
  return units;
};

const estimateBypassExtraMinutes = (distanceKm: number, isOpenBarrier: boolean): number => {
  if (isOpenBarrier) return MIN_OPEN_BARRIER_BYPASS_MINUTES;
  return Math.max(4, Math.round(distanceKm * 0.35));
};

const trimRunToValidEndpoints = (params: {
  dataset: TollDataset;
  run: ClosedTollRun;
  vehicleClass: VehicleClass;
}): ClosedTollRun => {
  const { dataset, run, vehicleClass } = params;
  const n = run.plazas.length;
  if (n < 2) return run;

  const first = run.plazas[0];
  const last = run.plazas[n - 1];
  if (
    first &&
    last &&
    lookupTariffEur({
      dataset,
      fromId: first.plaza.id,
      toId: last.plaza.id,
      vehicleClass,
    }) !== null
  ) {
    return run;
  }

  let bestStart = 0;
  let bestEnd = n - 1;
  let bestSpanKm = -1;

  for (let i = 0; i < n - 1; i += 1) {
    const fromPlaza = run.plazas[i];
    if (!fromPlaza) continue;
    for (let j = n - 1; j > i; j -= 1) {
      const toPlaza = run.plazas[j];
      if (!toPlaza) continue;
      const spanKm = toPlaza.distanceAlongRouteKm - fromPlaza.distanceAlongRouteKm;
      if (spanKm <= bestSpanKm) break;
      if (
        lookupTariffEur({
          dataset,
          fromId: fromPlaza.plaza.id,
          toId: toPlaza.plaza.id,
          vehicleClass,
        }) !== null
      ) {
        bestSpanKm = spanKm;
        bestStart = i;
        bestEnd = j;
        break;
      }
    }
  }

  if (bestSpanKm < 0) return run;
  const trimmedPlazas = run.plazas.slice(bestStart, bestEnd + 1);
  return {
    ...run,
    highways: Array.from(new Set(trimmedPlazas.map((m) => m.plaza.highway))),
    plazas: trimmedPlazas,
  };
};

export const resolveRunEntryExitIndices = (params: {
  run: ClosedTollRun;
  override?: RunEntryExitOverride;
}): { entryIdx: number; exitIdx: number } => {
  const { run, override } = params;
  const lastIdx = Math.max(0, run.plazas.length - 1);
  let entryIdx = 0;
  let exitIdx = lastIdx;

  if (override?.entryPlazaId) {
    const found = run.plazas.findIndex((item) => item.plaza.id === override.entryPlazaId);
    if (found >= 0 && found < lastIdx) {
      entryIdx = found;
    }
  }

  if (override?.exitPlazaId) {
    const found = run.plazas.findIndex((item) => item.plaza.id === override.exitPlazaId);
    if (found > entryIdx && found <= lastIdx) {
      exitIdx = found;
    }
  }

  return { entryIdx, exitIdx };
};

export const matchRouteTollUnits = (params: {
  dataset: TollDataset;
  coordinates: Array<[number, number]>;
  vehicleClass: VehicleClass;
  corridorKm?: number;
}): MatchedTollUnit[] => {
  const { dataset, coordinates, vehicleClass, corridorKm } = params;
  const matchedPlazas = matchPlazasToRoute({
    coordinates,
    plazas: dataset.plazas,
    corridorKm,
  });
  return groupMatchedPlazasIntoUnits(matchedPlazas).map((unit) =>
    unit.kind === "closed" ? trimRunToValidEndpoints({ dataset, run: unit, vehicleClass }) : unit,
  );
};

export const priceMatchedTollUnits = (params: {
  dataset: TollDataset;
  coordinates: Array<[number, number]>;
  units: MatchedTollUnit[];
  vehicleClass: VehicleClass;
  splitPlazaIds: ReadonlySet<string>;
  bypassedSectionIds: ReadonlySet<string>;
  runOverrides?: Readonly<Record<string, RunEntryExitOverride>>;
  splitExtraMinutes?: number;
}): PricedRouteSummary => {
  const {
    dataset,
    coordinates,
    units,
    vehicleClass,
    splitPlazaIds,
    bypassedSectionIds,
    runOverrides,
    splitExtraMinutes = SPLIT_EXTRA_MINUTES,
  } = params;

  const sections: PricedTollSection[] = [];
  let directTollEur = 0;
  let currentTollEur = 0;
  let comparableDirectEur = 0;
  let comparableCurrentEur = 0;
  let splitCount = 0;
  let bypassCount = 0;
  let addedMinutes = 0;
  let addedDistanceKm = 0;
  let unknownSectionCount = 0;

  for (const unit of units) {
    if (unit.kind === "open") {
      const price = lookupTariffEur({
        dataset,
        fromId: unit.plaza.plaza.id,
        toId: unit.plaza.plaza.id,
        vehicleClass,
      });
      const sectionId = `sec:${unit.id}`;
      const isBypassed = bypassedSectionIds.has(sectionId);
      const bypassMinutes = estimateBypassExtraMinutes(0, true);
      const freeFlow = isFreeFlowPlaza(unit.plaza.plaza);

      if (price !== null) {
        directTollEur += price;
        comparableDirectEur += price;
      } else {
        unknownSectionCount += 1;
      }

      const effectivePrice = isBypassed ? 0 : (price ?? 0);
      currentTollEur += effectivePrice;
      if (price !== null) {
        comparableCurrentEur += effectivePrice;
      }

      if (isBypassed) {
        bypassCount += 1;
        addedMinutes += bypassMinutes;
        addedDistanceKm += 3.5;
      }

      const startIdx = Math.max(0, unit.plaza.routeCoordIndex - 2);
      const endIdx = Math.min(coordinates.length - 1, unit.plaza.routeCoordIndex + 2);

      sections.push({
        id: sectionId,
        runId: unit.id,
        kind: "open",
        concessionaire: unit.concessionaire,
        highway: unit.highway,
        fromPlaza: unit.plaza,
        toPlaza: unit.plaza,
        distanceKm: 0,
        basePriceEur: price,
        effectivePriceEur: roundEur(effectivePrice),
        isBypassed,
        isSplitStart: false,
        isSplitEnd: false,
        isFreeFlow: freeFlow,
        freeFlowPaymentUrl: getFreeFlowPaymentUrl(unit.plaza.plaza),
        bypassExtraMinutes: bypassMinutes,
        coordinates: sliceRouteCoordinates(coordinates, startIdx, endIdx),
      });
      continue;
    }

    const firstPlaza = unit.plazas[0];
    const lastPlaza = unit.plazas[unit.plazas.length - 1];
    if (!firstPlaza || !lastPlaza) continue;

    const directRunPrice = lookupTariffEur({
      dataset,
      fromId: firstPlaza.plaza.id,
      toId: lastPlaza.plaza.id,
      vehicleClass,
    });

    if (directRunPrice !== null) {
      directTollEur += directRunPrice;
    }

    const { entryIdx, exitIdx } = resolveRunEntryExitIndices({
      run: unit,
      override: runOverrides?.[unit.id],
    });
    const entryPlaza = unit.plazas[entryIdx];
    const exitPlaza = unit.plazas[exitIdx];
    if (!entryPlaza || !exitPlaza) continue;

    const runIsFreeFlow = isFreeFlowPlaza(firstPlaza.plaza) || isFreeFlowPlaza(lastPlaza.plaza);
    const runFreeFlowUrl =
      getFreeFlowPaymentUrl(firstPlaza.plaza) ?? getFreeFlowPaymentUrl(lastPlaza.plaza);

    if (entryIdx > 0) {
      const prePrice = lookupTariffEur({
        dataset,
        fromId: firstPlaza.plaza.id,
        toId: entryPlaza.plaza.id,
        vehicleClass,
      });
      const preDistanceKm = Math.max(
        0,
        roundEur(entryPlaza.distanceAlongRouteKm - firstPlaza.distanceAlongRouteKm),
      );
      const preBypassMinutes = estimateBypassExtraMinutes(preDistanceKm, false);
      bypassCount += 1;
      addedMinutes += preBypassMinutes;
      addedDistanceKm += roundEur(preDistanceKm * 0.12);

      sections.push({
        id: `sec:${unit.id}:pre:${firstPlaza.plaza.id}->${entryPlaza.plaza.id}`,
        runId: unit.id,
        kind: "closed",
        concessionaire: unit.concessionaire,
        highway: firstPlaza.plaza.highway,
        fromPlaza: firstPlaza,
        toPlaza: entryPlaza,
        distanceKm: preDistanceKm,
        basePriceEur: prePrice,
        effectivePriceEur: 0,
        isBypassed: true,
        bypassRole: "before-entry",
        isSplitStart: false,
        isSplitEnd: false,
        isFreeFlow: runIsFreeFlow,
        freeFlowPaymentUrl: runFreeFlowUrl,
        bypassExtraMinutes: preBypassMinutes,
        coordinates: sliceRouteCoordinates(
          coordinates,
          firstPlaza.routeCoordIndex,
          entryPlaza.routeCoordIndex,
        ),
      });
    }

    const activeStopIndices: number[] = [entryIdx];
    for (let i = entryIdx + 1; i < exitIdx; i += 1) {
      const candidate = unit.plazas[i];
      if (candidate && !isFreeFlowPlaza(candidate.plaza) && splitPlazaIds.has(candidate.plaza.id)) {
        activeStopIndices.push(i);
        splitCount += 1;
        addedMinutes += splitExtraMinutes;
        addedDistanceKm += SPLIT_EXTRA_KM;
      }
    }
    activeStopIndices.push(exitIdx);

    let runCurrentTotal = 0;
    let runHasUnknownActiveSection = false;

    for (let s = 0; s < activeStopIndices.length - 1; s += 1) {
      const fromIdx = activeStopIndices[s];
      const toIdx = activeStopIndices[s + 1];
      if (fromIdx === undefined || toIdx === undefined) continue;
      const fromPlaza = unit.plazas[fromIdx];
      const toPlaza = unit.plazas[toIdx];
      if (!fromPlaza || !toPlaza) continue;

      const sectionId = `sec:${unit.id}:${fromPlaza.plaza.id}->${toPlaza.plaza.id}`;
      const isBypassed = bypassedSectionIds.has(sectionId);
      const basePrice = lookupTariffEur({
        dataset,
        fromId: fromPlaza.plaza.id,
        toId: toPlaza.plaza.id,
        vehicleClass,
      });

      if (basePrice === null) {
        unknownSectionCount += 1;
        if (!isBypassed) {
          runHasUnknownActiveSection = true;
        }
      }

      const distanceKm = Math.max(
        0,
        roundEur(toPlaza.distanceAlongRouteKm - fromPlaza.distanceAlongRouteKm),
      );
      const bypassMinutes = estimateBypassExtraMinutes(distanceKm, false);
      const effectivePrice = isBypassed ? 0 : (basePrice ?? 0);
      currentTollEur += effectivePrice;
      runCurrentTotal += effectivePrice;

      if (isBypassed) {
        bypassCount += 1;
        addedMinutes += bypassMinutes;
        addedDistanceKm += roundEur(distanceKm * 0.12);
      }

      sections.push({
        id: sectionId,
        runId: unit.id,
        kind: "closed",
        concessionaire: unit.concessionaire,
        highway: fromPlaza.plaza.highway,
        fromPlaza,
        toPlaza,
        distanceKm,
        basePriceEur: basePrice,
        effectivePriceEur: roundEur(effectivePrice),
        isBypassed,
        bypassRole: isBypassed ? "manual" : undefined,
        isSplitStart: s > 0,
        isSplitEnd: s < activeStopIndices.length - 2,
        isFreeFlow: runIsFreeFlow,
        freeFlowPaymentUrl: runFreeFlowUrl,
        bypassExtraMinutes: bypassMinutes,
        coordinates: sliceRouteCoordinates(
          coordinates,
          fromPlaza.routeCoordIndex,
          toPlaza.routeCoordIndex,
        ),
      });
    }

    if (directRunPrice !== null && !runHasUnknownActiveSection) {
      comparableDirectEur += directRunPrice;
      comparableCurrentEur += runCurrentTotal;
    }

    if (exitIdx < unit.plazas.length - 1) {
      const postPrice = lookupTariffEur({
        dataset,
        fromId: exitPlaza.plaza.id,
        toId: lastPlaza.plaza.id,
        vehicleClass,
      });
      const postDistanceKm = Math.max(
        0,
        roundEur(lastPlaza.distanceAlongRouteKm - exitPlaza.distanceAlongRouteKm),
      );
      const postBypassMinutes = estimateBypassExtraMinutes(postDistanceKm, false);
      bypassCount += 1;
      addedMinutes += postBypassMinutes;
      addedDistanceKm += roundEur(postDistanceKm * 0.12);

      sections.push({
        id: `sec:${unit.id}:post:${exitPlaza.plaza.id}->${lastPlaza.plaza.id}`,
        runId: unit.id,
        kind: "closed",
        concessionaire: unit.concessionaire,
        highway: exitPlaza.plaza.highway,
        fromPlaza: exitPlaza,
        toPlaza: lastPlaza,
        distanceKm: postDistanceKm,
        basePriceEur: postPrice,
        effectivePriceEur: 0,
        isBypassed: true,
        bypassRole: "after-exit",
        isSplitStart: false,
        isSplitEnd: false,
        isFreeFlow: runIsFreeFlow,
        freeFlowPaymentUrl: runFreeFlowUrl,
        bypassExtraMinutes: postBypassMinutes,
        coordinates: sliceRouteCoordinates(
          coordinates,
          exitPlaza.routeCoordIndex,
          lastPlaza.routeCoordIndex,
        ),
      });
    }
  }

  const roundedDirect = roundEur(directTollEur);
  const roundedCurrent = roundEur(currentTollEur);
  const savingsEur = roundEur(Math.max(0, comparableDirectEur - comparableCurrentEur));
  const savingsPercent =
    comparableDirectEur > 0 ? Math.round((savingsEur / comparableDirectEur) * 1000) / 10 : 0;

  return {
    units,
    sections,
    directTollEur: roundedDirect,
    currentTollEur: roundedCurrent,
    savingsEur,
    savingsPercent,
    splitCount,
    bypassCount,
    addedMinutes: Math.round(addedMinutes),
    addedDistanceKm: roundEur(addedDistanceKm),
    unknownSectionCount,
  };
};

export const evaluateRouteTolls = (params: {
  dataset: TollDataset;
  coordinates: Array<[number, number]>;
  vehicleClass: VehicleClass;
  splitPlazaIds: ReadonlySet<string>;
  bypassedSectionIds: ReadonlySet<string>;
  runOverrides?: Readonly<Record<string, RunEntryExitOverride>>;
  corridorKm?: number;
  splitExtraMinutes?: number;
}): PricedRouteSummary => {
  const units = matchRouteTollUnits({
    dataset: params.dataset,
    coordinates: params.coordinates,
    vehicleClass: params.vehicleClass,
    corridorKm: params.corridorKm,
  });
  return priceMatchedTollUnits({
    dataset: params.dataset,
    coordinates: params.coordinates,
    units,
    vehicleClass: params.vehicleClass,
    splitPlazaIds: params.splitPlazaIds,
    bypassedSectionIds: params.bypassedSectionIds,
    runOverrides: params.runOverrides,
    splitExtraMinutes: params.splitExtraMinutes,
  });
};

interface RunDpSolution {
  costEur: number;
  splitIds: string[];
}

const solveClosedRunDp = (params: {
  dataset: TollDataset;
  run: ClosedTollRun;
  vehicleClass: VehicleClass;
  maxSplits: number;
  override?: RunEntryExitOverride;
}): RunDpSolution[] => {
  const { dataset, run, vehicleClass, maxSplits, override } = params;
  const { entryIdx, exitIdx } = resolveRunEntryExitIndices({ run, override });
  const subPlazas = run.plazas.slice(entryIdx, exitIdx + 1);
  const n = subPlazas.length;
  const INF = Number.POSITIVE_INFINITY;

  const dpCost: number[][] = Array.from({ length: n }, () =>
    Array.from({ length: maxSplits + 1 }, () => INF),
  );
  const parentIdx: number[][] = Array.from({ length: n }, () =>
    Array.from({ length: maxSplits + 1 }, () => -1),
  );

  const row0 = dpCost[0];
  if (row0) row0[0] = 0;

  for (let i = 1; i < n; i += 1) {
    const toPlaza = subPlazas[i];
    const dpRowI = dpCost[i];
    const parentRowI = parentIdx[i];
    if (!toPlaza || !dpRowI || !parentRowI) continue;
    if (i < n - 1 && isFreeFlowPlaza(toPlaza.plaza)) continue;

    for (let prev = 0; prev < i; prev += 1) {
      const fromPlaza = subPlazas[prev];
      const dpRowPrev = dpCost[prev];
      if (!fromPlaza || !dpRowPrev) continue;
      if (prev > 0 && isFreeFlowPlaza(fromPlaza.plaza)) continue;

      const edgeCost = lookupTariffEur({
        dataset,
        fromId: fromPlaza.plaza.id,
        toId: toPlaza.plaza.id,
        vehicleClass,
      });
      if (edgeCost === null) continue;

      const splitsAdded = prev === 0 ? 0 : 1;
      for (let k = 0; k <= maxSplits - splitsAdded; k += 1) {
        const prevCost = dpRowPrev[k];
        if (prevCost === undefined || !Number.isFinite(prevCost)) continue;
        const nextK = k + splitsAdded;
        const candidateCost = prevCost + edgeCost;
        const currentBest = dpRowI[nextK] ?? INF;
        if (candidateCost + 1e-6 < currentBest) {
          dpRowI[nextK] = candidateCost;
          parentRowI[nextK] = prev;
        }
      }
    }
  }

  const solutions: RunDpSolution[] = [];
  const lastRow = dpCost[n - 1];
  for (let k = 0; k <= maxSplits; k += 1) {
    const cost = lastRow?.[k] ?? INF;
    if (!Number.isFinite(cost)) {
      solutions.push({ costEur: INF, splitIds: [] });
      continue;
    }

    const splits: string[] = [];
    let curr = n - 1;
    let remK = k;
    while (curr > 0) {
      const prev = parentIdx[curr]?.[remK] ?? -1;
      if (prev <= 0) break;
      const plaza = subPlazas[prev];
      if (plaza) splits.push(plaza.plaza.id);
      curr = prev;
      remK -= 1;
    }
    splits.reverse();
    solutions.push({ costEur: roundEur(cost), splitIds: splits });
  }

  return solutions;
};

export const optimizeTollSplits = (params: {
  dataset: TollDataset;
  units: MatchedTollUnit[];
  vehicleClass: VehicleClass;
  maxAddedMinutes: number;
  runOverrides?: Readonly<Record<string, RunEntryExitOverride>>;
  splitExtraMinutes?: number;
}): OptimizationResult => {
  const {
    dataset,
    units,
    vehicleClass,
    maxAddedMinutes,
    runOverrides,
    splitExtraMinutes = SPLIT_EXTRA_MINUTES,
  } = params;
  const maxSplits = Math.max(0, Math.floor(maxAddedMinutes / Math.max(1, splitExtraMinutes)));
  const INF = Number.POSITIVE_INFINITY;

  let openBarrierTotal = 0;
  const closedRuns: ClosedTollRun[] = [];

  for (const unit of units) {
    if (unit.kind === "open") {
      const price = lookupTariffEur({
        dataset,
        fromId: unit.plaza.plaza.id,
        toId: unit.plaza.plaza.id,
        vehicleClass,
      });
      openBarrierTotal += price ?? 0;
    } else {
      closedRuns.push(unit);
    }
  }

  let directClosedTotal = 0;
  for (const run of closedRuns) {
    const { entryIdx, exitIdx } = resolveRunEntryExitIndices({
      run,
      override: runOverrides?.[run.id],
    });
    const first = run.plazas[entryIdx];
    const last = run.plazas[exitIdx];
    if (!first || !last) continue;
    const direct = lookupTariffEur({
      dataset,
      fromId: first.plaza.id,
      toId: last.plaza.id,
      vehicleClass,
    });
    directClosedTotal += direct ?? 0;
  }

  const directTollEur = roundEur(openBarrierTotal + directClosedTotal);

  let combined: RunDpSolution[] = Array.from({ length: maxSplits + 1 }, (_, k) => ({
    costEur: k === 0 ? 0 : INF,
    splitIds: [],
  }));

  for (const run of closedRuns) {
    const runSolutions = solveClosedRunDp({
      dataset,
      run,
      vehicleClass,
      maxSplits,
      override: runOverrides?.[run.id],
    });

    const nextCombined: RunDpSolution[] = Array.from({ length: maxSplits + 1 }, () => ({
      costEur: INF,
      splitIds: [],
    }));

    for (let used = 0; used <= maxSplits; used += 1) {
      const base = combined[used];
      if (!base || !Number.isFinite(base.costEur)) continue;

      for (let add = 0; add <= maxSplits - used; add += 1) {
        const piece = runSolutions[add];
        if (!piece || !Number.isFinite(piece.costEur)) continue;
        const totalK = used + add;
        const candidateCost = base.costEur + piece.costEur;
        const existing = nextCombined[totalK];
        if (existing && candidateCost + 1e-6 < existing.costEur) {
          nextCombined[totalK] = {
            costEur: roundEur(candidateCost),
            splitIds: [...base.splitIds, ...piece.splitIds],
          };
        }
      }
    }

    combined = nextCombined;
  }

  let bestSolution: RunDpSolution = {
    costEur: directClosedTotal,
    splitIds: [],
  };

  for (let k = 0; k <= maxSplits; k += 1) {
    const candidate = combined[k];
    if (!candidate || !Number.isFinite(candidate.costEur)) continue;
    if (candidate.costEur + 0.05 < bestSolution.costEur) {
      bestSolution = candidate;
    }
  }

  const optimizedTollEur = roundEur(openBarrierTotal + bestSolution.costEur);
  const savingsEur = roundEur(Math.max(0, directTollEur - optimizedTollEur));
  const savingsPercent =
    directTollEur > 0 ? Math.round((savingsEur / directTollEur) * 1000) / 10 : 0;
  const addedMinutes = bestSolution.splitIds.length * splitExtraMinutes;
  const savingsPerHourEur = addedMinutes > 0 ? roundEur((savingsEur / addedMinutes) * 60) : 0;

  return {
    splitPlazaIds: bestSolution.splitIds,
    directTollEur,
    optimizedTollEur,
    savingsEur,
    savingsPercent,
    addedMinutes,
    savingsPerHourEur,
  };
};

export const estimateFuelCostEur = (params: {
  distanceKm: number;
  litersPer100Km: number;
  fuelPricePerLiterEur: number;
}): number => {
  const { distanceKm, litersPer100Km, fuelPricePerLiterEur } = params;
  return roundEur((distanceKm / 100) * litersPer100Km * fuelPricePerLiterEur);
};

export const computeSectionHourlyRateEur = (params: {
  priceEur: number | null;
  savedMinutes: number;
}): number | null => {
  const { priceEur, savedMinutes } = params;
  if (priceEur === null || priceEur <= 0 || savedMinutes <= 0) return null;
  return Math.round((priceEur / (savedMinutes / 60)) * 10) / 10;
};

export const evaluateIntermediateSplitCandidates = (params: {
  dataset: TollDataset;
  run: ClosedTollRun;
  vehicleClass: VehicleClass;
  splitPlazaIds: ReadonlySet<string>;
  override?: RunEntryExitOverride;
  splitExtraMinutes?: number;
}): SplitCandidateInsight[] => {
  const {
    dataset,
    run,
    vehicleClass,
    splitPlazaIds,
    override,
    splitExtraMinutes = SPLIT_EXTRA_MINUTES,
  } = params;
  const { entryIdx, exitIdx } = resolveRunEntryExitIndices({ run, override });
  if (exitIdx - entryIdx < 2) return [];

  const activeIndices: number[] = [entryIdx];
  for (let i = entryIdx + 1; i < exitIdx; i += 1) {
    const candidate = run.plazas[i];
    if (candidate && !isFreeFlowPlaza(candidate.plaza) && splitPlazaIds.has(candidate.plaza.id)) {
      activeIndices.push(i);
    }
  }
  activeIndices.push(exitIdx);

  const insights: SplitCandidateInsight[] = [];

  for (let i = entryIdx + 1; i < exitIdx; i += 1) {
    const matched = run.plazas[i];
    if (!matched || isFreeFlowPlaza(matched.plaza)) continue;

    const isActive = splitPlazaIds.has(matched.plaza.id);

    let prevIdx = entryIdx;
    let nextIdx = exitIdx;
    for (const boundaryIdx of activeIndices) {
      if (boundaryIdx < i) {
        prevIdx = boundaryIdx;
      } else if (boundaryIdx > i) {
        nextIdx = boundaryIdx;
        break;
      }
    }

    const prevPlaza = run.plazas[prevIdx];
    const nextPlaza = run.plazas[nextIdx];
    if (!prevPlaza || !nextPlaza) continue;

    const directCost = lookupTariffEur({
      dataset,
      fromId: prevPlaza.plaza.id,
      toId: nextPlaza.plaza.id,
      vehicleClass,
    });
    const firstLegCost = lookupTariffEur({
      dataset,
      fromId: prevPlaza.plaza.id,
      toId: matched.plaza.id,
      vehicleClass,
    });
    const secondLegCost = lookupTariffEur({
      dataset,
      fromId: matched.plaza.id,
      toId: nextPlaza.plaza.id,
      vehicleClass,
    });

    const savingsEur =
      directCost !== null && firstLegCost !== null && secondLegCost !== null
        ? roundEur(directCost - (firstLegCost + secondLegCost))
        : null;
    const savingsPerHourEur =
      savingsEur !== null && savingsEur > 0
        ? roundEur((savingsEur / Math.max(1, splitExtraMinutes)) * 60)
        : null;

    insights.push({
      matched,
      isActive,
      savingsEur,
      savingsPerHourEur,
    });
  }

  return insights;
};

export const computeEffectiveRouteMetrics = (params: {
  summary: PricedRouteSummary;
  bypassStates: Readonly<Record<string, BypassDetourState>>;
  splitExtraMinutes?: number;
}): { addedMinutes: number; addedDistanceKm: number } => {
  const { summary, bypassStates, splitExtraMinutes = SPLIT_EXTRA_MINUTES } = params;
  let totalMinutes = summary.splitCount * splitExtraMinutes;
  let totalDistanceKm = summary.splitCount * SPLIT_EXTRA_KM;

  for (const section of summary.sections) {
    if (!section.isBypassed) continue;
    const state = bypassStates[section.id];
    if (state?.status === "ready") {
      totalMinutes += state.detour.extraMinutes;
      totalDistanceKm += state.detour.extraDistanceKm;
    } else {
      totalMinutes += section.bypassExtraMinutes;
      totalDistanceKm +=
        section.kind === "open" ? 3.5 : Math.round(section.distanceKm * 0.12 * 10) / 10;
    }
  }

  return {
    addedMinutes: Math.round(totalMinutes),
    addedDistanceKm: Math.round(totalDistanceKm * 10) / 10,
  };
};

export const computeProfileOptimization = (params: {
  dataset: TollDataset;
  coordinates: Array<[number, number]>;
  units: MatchedTollUnit[];
  vehicleClass: VehicleClass;
  profile: OptimizationProfile;
  splitExtraMinutes?: number;
}): {
  splitPlazaIds: string[];
  bypassedSectionIds: string[];
  showTollFree: boolean;
} => {
  const {
    dataset,
    coordinates,
    units,
    vehicleClass,
    profile,
    splitExtraMinutes = SPLIT_EXTRA_MINUTES,
  } = params;

  if (profile === "fast") {
    return { splitPlazaIds: [], bypassedSectionIds: [], showTollFree: false };
  }

  if (profile === "free") {
    return { splitPlazaIds: [], bypassedSectionIds: [], showTollFree: true };
  }

  const maxAddedMinutes = profile === "balanced" ? splitExtraMinutes * 2 : splitExtraMinutes * 4;
  const opt = optimizeTollSplits({
    dataset,
    units,
    vehicleClass,
    maxAddedMinutes,
    splitExtraMinutes,
  });

  if (profile === "balanced") {
    return {
      splitPlazaIds: opt.splitPlazaIds,
      bypassedSectionIds: [],
      showTollFree: false,
    };
  }

  const priced = priceMatchedTollUnits({
    dataset,
    coordinates,
    units,
    vehicleClass,
    splitPlazaIds: new Set(opt.splitPlazaIds),
    bypassedSectionIds: new Set(),
    splitExtraMinutes,
  });

  const bypassedSectionIds: string[] = [];
  for (const section of priced.sections) {
    const hourlyRate = computeSectionHourlyRateEur({
      priceEur: section.basePriceEur,
      savedMinutes: section.bypassExtraMinutes,
    });
    if (hourlyRate !== null && hourlyRate >= 28) {
      bypassedSectionIds.push(section.id);
    }
  }

  return {
    splitPlazaIds: opt.splitPlazaIds,
    bypassedSectionIds,
    showTollFree: false,
  };
};
