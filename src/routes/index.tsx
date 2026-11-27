import { createQuery } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { z } from "zod";
import { RouteSidebar, type MobileSheetMode, type RouteStopItem } from "~/components/route-sidebar";
import { TollMap } from "~/components/toll-map";
import { buildCumulativeDistancesKm, findCoordIndexAtDistanceOffset } from "~/domain/geo";
import {
  computeProfileOptimization,
  getSplitExtraMinutes,
  matchRouteTollUnits,
  optimizeTollSplits,
  priceMatchedTollUnits,
} from "~/domain/toll-calculator";
import {
  TollDatasetSchema,
  VehicleClassSchema,
  type BypassDetourState,
  type OptimizationProfile,
  type PlaceSuggestion,
  type RunEntryExitOverride,
  type TollDataset,
  type VehicleClass,
} from "~/domain/toll-types";
import {
  computeBypassSegment,
  computeHighwayRoute,
  computeTollFreeRoute,
  reverseGeocode,
} from "~/lib/routing";

const FlagParamSchema = z
  .union([z.literal("0"), z.literal("1"), z.literal(0), z.literal(1), z.boolean()])
  .transform((value): "0" | "1" => (value === "1" || value === 1 || value === true ? "1" : "0"))
  .optional()
  .catch(undefined);

const OptionalStringParamSchema = z.string().optional().catch(undefined);

const SearchParamsSchema = z.object({
  from: OptionalStringParamSchema,
  to: OptionalStringParamSchema,
  stops: OptionalStringParamSchema,
  vc: VehicleClassSchema.optional().catch(undefined),
  tp: FlagParamSchema,
  splits: OptionalStringParamSchema,
  bypasses: OptionalStringParamSchema,
  tf: FlagParamSchema,
});

const encodePlaceParam = (place: PlaceSuggestion): string =>
  `${place.label}|${place.lat.toFixed(5)}|${place.lon.toFixed(5)}`;

const decodePlaceParam = (raw: string | undefined, prefix: string): PlaceSuggestion | null => {
  if (!raw) return null;
  const parts = raw.split("|");
  if (parts.length < 3) return null;
  const lon = Number(parts[parts.length - 1]);
  const lat = Number(parts[parts.length - 2]);
  const label = parts.slice(0, -2).join("|").trim();
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id: `${prefix}-${lat.toFixed(4)}-${lon.toFixed(4)}`,
    label,
    subtitle: "Partagé par lien",
    lat,
    lon,
  };
};

const fetchTollDataset = async (): Promise<TollDataset> => {
  const response = await fetch(`${import.meta.env.BASE_URL}data/tolls-fr-2026.json`);
  if (!response.ok) {
    throw new Error(`Impossible de charger les tarifs péages (${response.status})`);
  }
  const json: unknown = await response.json();
  return TollDatasetSchema.parse(json);
};

interface CustomizationSnapshot {
  splitPlazaIds: string[];
  bypassedSectionIds: string[];
  runOverrides: Record<string, RunEntryExitOverride>;
  showTollFree: boolean;
  activeProfile: OptimizationProfile | null;
}

const MAX_UNDO_HISTORY = 30;

let stopIdCounter = 0;

const HomePage = () => {
  const search = Route.useSearch();

  const [hydrated, setHydrated] = createSignal(false);
  const [origin, setOrigin] = createSignal<PlaceSuggestion | null>(null);
  const [destination, setDestination] = createSignal<PlaceSuggestion | null>(null);
  const [stops, setStops] = createSignal<RouteStopItem[]>([]);
  const [vehicleClass, setVehicleClass] = createSignal<VehicleClass>("c1");
  const [hasTelepeage, setHasTelepeage] = createSignal(false);
  const [splitPlazaIds, setSplitPlazaIds] = createSignal<Set<string>>(new Set());
  const [bypassedSectionIds, setBypassedSectionIds] = createSignal<Set<string>>(new Set());
  const [runOverrides, setRunOverrides] = createSignal<Record<string, RunEntryExitOverride>>({});
  const [bypassStates, setBypassStates] = createSignal<Record<string, BypassDetourState>>({});
  const [maxAddedMinutes, setMaxAddedMinutes] = createSignal(12);
  const [showTollFree, setShowTollFree] = createSignal(false);
  const [activeProfile, setActiveProfile] = createSignal<OptimizationProfile | null>("fast");
  const [selectedSectionId, setSelectedSectionId] = createSignal<string | null>(null);
  const [hoveredSectionId, setHoveredSectionId] = createSignal<string | null>(null);
  const [focusSectionToken, setFocusSectionToken] = createSignal(0);
  const [scrollToSelectedToken, setScrollToSelectedToken] = createSignal(0);
  const [mobileSheetMode, setMobileSheetMode] = createSignal<MobileSheetMode>("half");
  const [undoStack, setUndoStack] = createSignal<CustomizationSnapshot[]>([]);

  const cloneRunOverrides = (
    overrides: Readonly<Record<string, RunEntryExitOverride>>,
  ): Record<string, RunEntryExitOverride> => {
    const copy: Record<string, RunEntryExitOverride> = {};
    for (const [key, value] of Object.entries(overrides)) {
      copy[key] = { ...value };
    }
    return copy;
  };

  const pushUndoSnapshot = () => {
    const snapshot: CustomizationSnapshot = {
      splitPlazaIds: Array.from(splitPlazaIds()),
      bypassedSectionIds: Array.from(bypassedSectionIds()),
      runOverrides: cloneRunOverrides(runOverrides()),
      showTollFree: showTollFree(),
      activeProfile: activeProfile(),
    };
    setUndoStack((prev) => [...prev.slice(-(MAX_UNDO_HISTORY - 1)), snapshot]);
  };

  const handleUndo = () => {
    const stack = undoStack();
    const last = stack[stack.length - 1];
    if (!last) return;
    setUndoStack(stack.slice(0, -1));
    setSplitPlazaIds(new Set(last.splitPlazaIds));
    setBypassedSectionIds(new Set(last.bypassedSectionIds));
    setRunOverrides(cloneRunOverrides(last.runOverrides));
    setShowTollFree(last.showTollFree);
    setActiveProfile(last.activeProfile);
  };

  let skipNextRouteReset = false;

  onMount(() => {
    const initial = search();
    const initialOrigin = decodePlaceParam(initial.from, "url-origin");
    const initialDest = decodePlaceParam(initial.to, "url-dest");
    if (initialOrigin && initialDest) {
      skipNextRouteReset = true;
      setOrigin(initialOrigin);
      setDestination(initialDest);
      if (initial.stops) {
        const parsedStops = initial.stops
          .split(";")
          .map((item, idx) => decodePlaceParam(item, `url-stop-${idx}`))
          .filter((place): place is PlaceSuggestion => place !== null)
          .map((place) => {
            stopIdCounter += 1;
            return { id: `stop-${stopIdCounter}`, place };
          });
        setStops(parsedStops);
      }
      if (initial.vc) setVehicleClass(initial.vc);
      if (initial.tp === "1") setHasTelepeage(true);
      if (initial.tf === "1") {
        setShowTollFree(true);
        setActiveProfile("free");
      }
      if (initial.splits) {
        setSplitPlazaIds(new Set(initial.splits.split(",").filter(Boolean)));
        setActiveProfile(null);
      }
      if (initial.bypasses) {
        setBypassedSectionIds(new Set(initial.bypasses.split(",").filter(Boolean)));
        setActiveProfile(null);
      }
    }
    setHydrated(true);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (undoStack().length === 0) return;
      event.preventDefault();
      handleUndo();
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  const splitExtraMinutes = () => getSplitExtraMinutes(hasTelepeage());

  const activeStops = createMemo<PlaceSuggestion[]>(() =>
    stops()
      .map((stop) => stop.place)
      .filter((place): place is PlaceSuggestion => place !== null),
  );

  // Sync URL query params cleanly via replaceState
  createEffect(() => {
    if (!hydrated() || typeof window === "undefined") return;
    const from = origin();
    const to = destination();
    const params = new URLSearchParams();
    if (from) params.set("from", encodePlaceParam(from));
    if (to) params.set("to", encodePlaceParam(to));
    const validStops = activeStops();
    if (validStops.length > 0) {
      params.set("stops", validStops.map(encodePlaceParam).join(";"));
    }
    if (vehicleClass() !== "c1") params.set("vc", vehicleClass());
    if (hasTelepeage()) params.set("tp", "1");
    if (showTollFree()) params.set("tf", "1");
    if (splitPlazaIds().size > 0) {
      params.set("splits", Array.from(splitPlazaIds()).join(","));
    }
    if (bypassedSectionIds().size > 0) {
      params.set("bypasses", Array.from(bypassedSectionIds()).join(","));
    }

    const qs = params.toString();
    const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  });

  const datasetQuery = createQuery(() => ({
    queryKey: ["toll-dataset", "fr-2026"],
    queryFn: fetchTollDataset,
    enabled: hydrated(),
    staleTime: Infinity,
  }));

  const routePointsKey = createMemo(() => {
    const from = origin();
    const to = destination();
    if (!from || !to) return "";
    const wpKey = activeStops()
      .map((s) => `${s.lon.toFixed(4)},${s.lat.toFixed(4)}`)
      .join(";");
    return `${from.lon.toFixed(4)},${from.lat.toFixed(4)}|${wpKey}|${to.lon.toFixed(4)},${to.lat.toFixed(4)}`;
  });

  const highwayQuery = createQuery(() => {
    const from = origin();
    const to = destination();
    const waypoints = activeStops().map((stop) => ({ lon: stop.lon, lat: stop.lat }));
    const key = routePointsKey();

    return {
      queryKey: ["highway-route", key],
      queryFn: () => {
        if (!from || !to) {
          throw new Error("Sélectionnez un départ et une arrivée");
        }
        return computeHighwayRoute({
          data: {
            origin: { lon: from.lon, lat: from.lat },
            destination: { lon: to.lon, lat: to.lat },
            waypoints,
          },
        });
      },
      enabled: hydrated() && Boolean(from && to),
      staleTime: 10 * 60_000,
    };
  });

  const tollFreeQuery = createQuery(() => {
    const from = origin();
    const to = destination();
    const waypoints = activeStops().map((stop) => ({ lon: stop.lon, lat: stop.lat }));
    const key = routePointsKey();

    return {
      queryKey: ["toll-free-route", key],
      queryFn: () => {
        if (!from || !to) return null;
        return computeTollFreeRoute({
          data: {
            origin: { lon: from.lon, lat: from.lat },
            destination: { lon: to.lon, lat: to.lat },
            waypoints,
          },
        });
      },
      enabled: hydrated() && Boolean(from && to),
      staleTime: 10 * 60_000,
    };
  });

  let routeGeneration = 0;

  createEffect(() => {
    const key = routePointsKey();
    if (!key) return;
    if (skipNextRouteReset) {
      skipNextRouteReset = false;
      return;
    }
    routeGeneration += 1;
    setSplitPlazaIds(new Set<string>());
    setBypassedSectionIds(new Set<string>());
    setRunOverrides({});
    setBypassStates({});
    setSelectedSectionId(null);
    setHoveredSectionId(null);
    setActiveProfile(showTollFree() ? "free" : "fast");
    setUndoStack([]);
  });

  const dataset = () => (datasetQuery.isSuccess ? datasetQuery.data : null);
  const highwayRoute = () =>
    highwayQuery.isSuccess && origin() && destination() ? highwayQuery.data : null;
  const tollFreeRoute = () =>
    tollFreeQuery.isSuccess && origin() && destination() ? tollFreeQuery.data : null;

  // Memo 1: Heavy geometric matching (runs only on route / dataset / vehicleClass change)
  const matchedUnits = createMemo(() => {
    const ds = dataset();
    const highway = highwayRoute();
    if (!ds || !highway) return [];
    return matchRouteTollUnits({
      dataset: ds,
      coordinates: highway.coordinates,
      vehicleClass: vehicleClass(),
    });
  });

  // Memo 2: Fast pricing pass (runs on splits / bypasses / overrides / télépéage)
  const summary = createMemo(() => {
    const ds = dataset();
    const highway = highwayRoute();
    if (!ds || !highway) return null;
    return priceMatchedTollUnits({
      dataset: ds,
      coordinates: highway.coordinates,
      units: matchedUnits(),
      vehicleClass: vehicleClass(),
      splitPlazaIds: splitPlazaIds(),
      bypassedSectionIds: bypassedSectionIds(),
      runOverrides: runOverrides(),
      splitExtraMinutes: splitExtraMinutes(),
    });
  });

  const optimization = createMemo(() => {
    const ds = dataset();
    const units = matchedUnits();
    if (!ds || units.length === 0) return null;
    return optimizeTollSplits({
      dataset: ds,
      units,
      vehicleClass: vehicleClass(),
      maxAddedMinutes: maxAddedMinutes(),
      runOverrides: runOverrides(),
      splitExtraMinutes: splitExtraMinutes(),
    });
  });

  const fetchBypassForSection = (sectionId: string) => {
    const currentSummary = summary();
    const highway = highwayRoute();
    if (!currentSummary || !highway) return;
    const section = currentSummary.sections.find((s) => s.id === sectionId);
    if (!section || !section.isBypassed) return;

    const generation = routeGeneration;
    let fromPoint = { lon: section.fromPlaza.plaza.lon, lat: section.fromPlaza.plaza.lat };
    let toPoint = { lon: section.toPlaza.plaza.lon, lat: section.toPlaza.plaza.lat };
    let startCoordIndex = section.fromPlaza.routeCoordIndex;
    let endCoordIndex = section.toPlaza.routeCoordIndex;
    let replacedHighwayKm = section.distanceKm;

    if (section.kind === "open") {
      const cumulative = buildCumulativeDistancesKm(highway.coordinates);
      startCoordIndex = findCoordIndexAtDistanceOffset({
        cumulativeDistancesKm: cumulative,
        originIndex: section.fromPlaza.routeCoordIndex,
        deltaKm: -3.0,
      });
      endCoordIndex = findCoordIndexAtDistanceOffset({
        cumulativeDistancesKm: cumulative,
        originIndex: section.toPlaza.routeCoordIndex,
        deltaKm: 3.0,
      });
      const startCoord = highway.coordinates[startCoordIndex];
      const endCoord = highway.coordinates[endCoordIndex];
      if (startCoord && endCoord) {
        fromPoint = { lon: startCoord[0], lat: startCoord[1] };
        toPoint = { lon: endCoord[0], lat: endCoord[1] };
      }
      replacedHighwayKm = Math.max(
        0,
        (cumulative[endCoordIndex] ?? 0) - (cumulative[startCoordIndex] ?? 0),
      );
    }

    setBypassStates((prev) => ({
      ...prev,
      [section.id]: { status: "loading" },
    }));

    void computeBypassSegment({
      data: { from: fromPoint, to: toPoint },
    })
      .then((detourRoute) => {
        if (generation !== routeGeneration) return;
        if (!detourRoute || detourRoute.coordinates.length < 2) {
          setBypassStates((prev) => ({
            ...prev,
            [section.id]: { status: "error", message: "Itinéraire hors péage indisponible" },
          }));
          return;
        }

        const highwaySectionMinutes = (replacedHighwayKm / 115) * 60;
        const extraMinutes = Math.max(
          1,
          Math.round(detourRoute.durationSeconds / 60 - highwaySectionMinutes),
        );
        const extraDistanceKm =
          Math.round((detourRoute.distanceMeters / 1000 - replacedHighwayKm) * 10) / 10;

        setBypassStates((prev) => ({
          ...prev,
          [section.id]: {
            status: "ready",
            detour: {
              sectionId: section.id,
              coordinates: detourRoute.coordinates,
              distanceMeters: detourRoute.distanceMeters,
              durationSeconds: detourRoute.durationSeconds,
              extraMinutes,
              extraDistanceKm,
              startCoordIndex,
              endCoordIndex,
            },
          },
        }));
      })
      .catch(() => {
        if (generation !== routeGeneration) return;
        setBypassStates((prev) => ({
          ...prev,
          [section.id]: { status: "error", message: "Erreur réseau lors du calcul" },
        }));
      });
  };

  // Auto-fetch bypass detours once per bypassed section (never loops on error!)
  createEffect(() => {
    const currentSummary = summary();
    if (!currentSummary) return;
    const states = bypassStates();

    for (const section of currentSummary.sections) {
      if (!section.isBypassed) continue;
      if (states[section.id]) continue;
      fetchBypassForSection(section.id);
    }
  });

  const handleAddStop = () => {
    if (stops().length >= 8) return;
    stopIdCounter += 1;
    setStops((prev) => [...prev, { id: `stop-${stopIdCounter}`, place: null }]);
  };

  const handleSelectStop = (stopId: string, place: PlaceSuggestion) => {
    setStops((prev) => prev.map((stop) => (stop.id === stopId ? { ...stop, place } : stop)));
  };

  const handleClearStop = (stopId: string) => {
    setStops((prev) => prev.map((stop) => (stop.id === stopId ? { ...stop, place: null } : stop)));
  };

  const handleRemoveStop = (stopId: string) => {
    setStops((prev) => prev.filter((stop) => stop.id !== stopId));
  };

  const handleMoveStop = (stopId: string, direction: "up" | "down") => {
    setStops((prev) => {
      const idx = prev.findIndex((stop) => stop.id === stopId);
      if (idx < 0) return prev;
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      const current = next[idx];
      const target = next[targetIdx];
      if (!current || !target) return prev;
      next[idx] = target;
      next[targetIdx] = current;
      return next;
    });
  };

  const handleSwapPlaces = () => {
    const prevOrigin = origin();
    const prevDestination = destination();
    setOrigin(prevDestination);
    setDestination(prevOrigin);
    setStops((prev) => prev.toReversed());
  };

  const handleSelectPreset = (from: PlaceSuggestion, to: PlaceSuggestion) => {
    setStops([]);
    setOrigin(from);
    setDestination(to);
  };

  const handleToggleSplitPlaza = (plazaId: string) => {
    pushUndoSnapshot();
    setActiveProfile(null);
    setSplitPlazaIds((prev) => {
      const next = new Set(prev);
      if (next.has(plazaId)) {
        next.delete(plazaId);
      } else {
        next.add(plazaId);
      }
      return next;
    });
  };

  const handleSetRunEntry = (runId: string, plazaId: string | undefined) => {
    const currentEntry = runOverrides()[runId]?.entryPlazaId;
    if (currentEntry === plazaId) return;
    pushUndoSnapshot();
    setActiveProfile(null);
    setRunOverrides((prev) => {
      const existing = prev[runId] ?? {};
      const nextEntry = plazaId;
      if (!nextEntry && !existing.exitPlazaId) {
        const { [runId]: _removed, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [runId]: { ...existing, entryPlazaId: nextEntry },
      };
    });
  };

  const handleSetRunExit = (runId: string, plazaId: string | undefined) => {
    const currentExit = runOverrides()[runId]?.exitPlazaId;
    if (currentExit === plazaId) return;
    pushUndoSnapshot();
    setActiveProfile(null);
    setRunOverrides((prev) => {
      const existing = prev[runId] ?? {};
      const nextExit = plazaId;
      if (!existing.entryPlazaId && !nextExit) {
        const { [runId]: _removed, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [runId]: { ...existing, exitPlazaId: nextExit },
      };
    });
  };

  const handleResetRunOverride = (runId: string) => {
    if (!runOverrides()[runId]) return;
    pushUndoSnapshot();
    setActiveProfile(null);
    setRunOverrides((prev) => {
      const { [runId]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const handleToggleBypassSection = (sectionId: string) => {
    const currentSection = summary()?.sections.find((section) => section.id === sectionId);
    if (currentSection?.bypassRole === "before-entry") {
      handleSetRunEntry(currentSection.runId, undefined);
      return;
    }
    if (currentSection?.bypassRole === "after-exit") {
      handleSetRunExit(currentSection.runId, undefined);
      return;
    }

    pushUndoSnapshot();
    setActiveProfile(null);
    setBypassedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const handleApplyOptimization = () => {
    const opt = optimization();
    if (!opt) return;
    pushUndoSnapshot();
    setActiveProfile(null);
    setShowTollFree(false);
    setSplitPlazaIds(new Set(opt.splitPlazaIds));
  };

  const handleApplyProfile = (profile: OptimizationProfile) => {
    const ds = dataset();
    const highway = highwayRoute();
    const units = matchedUnits();
    if (!ds || !highway) return;

    pushUndoSnapshot();
    const result = computeProfileOptimization({
      dataset: ds,
      coordinates: highway.coordinates,
      units,
      vehicleClass: vehicleClass(),
      profile,
      splitExtraMinutes: splitExtraMinutes(),
    });

    setRunOverrides({});
    setSplitPlazaIds(new Set(result.splitPlazaIds));
    setBypassedSectionIds(new Set(result.bypassedSectionIds));
    setShowTollFree(result.showTollFree);
    setActiveProfile(profile);
  };

  const handleResetCustomizations = () => {
    if (
      splitPlazaIds().size === 0 &&
      bypassedSectionIds().size === 0 &&
      Object.keys(runOverrides()).length === 0 &&
      !showTollFree()
    ) {
      return;
    }
    pushUndoSnapshot();
    setSplitPlazaIds(new Set<string>());
    setBypassedSectionIds(new Set<string>());
    setRunOverrides({});
    setShowTollFree(false);
    setSelectedSectionId(null);
    setActiveProfile("fast");
  };

  const handleSelectSection = (sectionId: string, fromMap = false) => {
    setSelectedSectionId(sectionId);
    if (fromMap) {
      setScrollToSelectedToken((n) => n + 1);
      if (mobileSheetMode() === "peek") {
        setMobileSheetMode("half");
      }
    } else {
      setFocusSectionToken((n) => n + 1);
    }
  };

  const handleMapPickPoint = (
    role: "origin" | "stop" | "destination",
    point: { lat: number; lon: number },
  ) => {
    void reverseGeocode({ data: point }).then((place) => {
      if (role === "origin") {
        setOrigin(place);
      } else if (role === "destination") {
        setDestination(place);
      } else if (stops().length < 8) {
        stopIdCounter += 1;
        setStops((prev) => [...prev, { id: `stop-${stopIdCounter}`, place }]);
      }
    });
  };

  const handleCopyShareLink = async (): Promise<boolean> => {
    if (typeof window === "undefined" || !navigator.clipboard) return false;
    try {
      await navigator.clipboard.writeText(window.location.href);
      return true;
    } catch {
      return false;
    }
  };

  const datasetStats = () => {
    const ds = dataset();
    if (!ds) return null;
    return {
      plazaCount: ds.plazas.length,
      tariffCount: Object.keys(ds.tariffs).length,
      version: ds.version,
    };
  };

  return (
    <main class="relative flex h-dvh w-screen overflow-hidden bg-slate-950">
      <RouteSidebar
        dataset={dataset()}
        datasetStats={datasetStats()}
        origin={origin()}
        destination={destination()}
        stops={stops()}
        onSelectOrigin={(place) => setOrigin(place)}
        onClearOrigin={() => setOrigin(null)}
        onSelectDestination={(place) => setDestination(place)}
        onClearDestination={() => setDestination(null)}
        onAddStop={handleAddStop}
        onSelectStop={handleSelectStop}
        onClearStop={handleClearStop}
        onRemoveStop={handleRemoveStop}
        onMoveStop={handleMoveStop}
        onSwapPlaces={handleSwapPlaces}
        onSelectPreset={handleSelectPreset}
        vehicleClass={vehicleClass()}
        onChangeVehicleClass={(cls) => setVehicleClass(cls)}
        hasTelepeage={hasTelepeage()}
        onToggleTelepeage={() => {
          const next = !hasTelepeage();
          setHasTelepeage(next);
          setMaxAddedMinutes(next ? 6 : 12);
        }}
        splitExtraMinutes={splitExtraMinutes()}
        isLoadingRoute={highwayQuery.isFetching && !highwayRoute()}
        isFetchingRoute={highwayQuery.isFetching}
        isLoadingTollFree={tollFreeQuery.isFetching && !tollFreeRoute()}
        routeError={
          highwayQuery.isError
            ? highwayQuery.error instanceof Error
              ? highwayQuery.error.message
              : "Erreur lors du calcul de l’itinéraire."
            : null
        }
        highwayRoute={highwayRoute()}
        tollFreeRoute={tollFreeRoute()}
        showTollFree={showTollFree()}
        onSetShowTollFree={(show) => {
          if (show === showTollFree()) return;
          pushUndoSnapshot();
          setShowTollFree(show);
          if (show) setActiveProfile("free");
          else if (activeProfile() === "free") setActiveProfile(null);
        }}
        summary={summary()}
        runOverrides={runOverrides()}
        onSetRunEntry={handleSetRunEntry}
        onSetRunExit={handleSetRunExit}
        onResetRunOverride={handleResetRunOverride}
        bypassStates={bypassStates()}
        optimization={optimization()}
        maxAddedMinutes={maxAddedMinutes()}
        onChangeMaxAddedMinutes={(minutes) => setMaxAddedMinutes(minutes)}
        onApplyOptimization={handleApplyOptimization}
        onApplyProfile={handleApplyProfile}
        activeProfile={activeProfile()}
        canUndo={undoStack().length > 0}
        onUndo={handleUndo}
        onResetCustomizations={handleResetCustomizations}
        splitPlazaIds={splitPlazaIds()}
        onToggleSplitPlaza={handleToggleSplitPlaza}
        onToggleBypassSection={handleToggleBypassSection}
        onRetryBypassSection={fetchBypassForSection}
        selectedSectionId={selectedSectionId()}
        hoveredSectionId={hoveredSectionId()}
        scrollToSelectedToken={scrollToSelectedToken()}
        onSelectSection={(id) => handleSelectSection(id, false)}
        onHoverSection={(id) => setHoveredSectionId(id)}
        onCopyShareLink={handleCopyShareLink}
        mobileSheetMode={mobileSheetMode()}
        onChangeMobileSheetMode={(mode) => setMobileSheetMode(mode)}
      />

      <section class="relative h-full w-full flex-1 bg-slate-900">
        <TollMap
          dataset={dataset()}
          vehicleClass={vehicleClass()}
          splitExtraMinutes={splitExtraMinutes()}
          origin={origin()}
          destination={destination()}
          stops={activeStops()}
          highwayRoute={highwayRoute()}
          tollFreeRoute={tollFreeRoute()}
          showTollFree={showTollFree()}
          units={matchedUnits()}
          sections={summary()?.sections ?? []}
          runOverrides={runOverrides()}
          onSetRunEntry={handleSetRunEntry}
          onSetRunExit={handleSetRunExit}
          bypassStates={bypassStates()}
          splitPlazaIds={splitPlazaIds()}
          selectedSectionId={selectedSectionId()}
          hoveredSectionId={hoveredSectionId()}
          focusSectionToken={focusSectionToken()}
          onToggleSplitPlaza={handleToggleSplitPlaza}
          onToggleBypassSection={handleToggleBypassSection}
          onSelectSection={(id, fromMap) => handleSelectSection(id, fromMap)}
          onHoverSection={(id) => setHoveredSectionId(id)}
          onMapPickPoint={handleMapPickPoint}
          canUndo={undoStack().length > 0}
          onUndo={handleUndo}
        />
      </section>
    </main>
  );
};

export const Route = createFileRoute("/")({
  validateSearch: (search) => SearchParamsSchema.parse(search),
  component: HomePage,
});
