import { createQuery } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { createEffect, createMemo, createSignal, onMount } from "solid-js";
import { RouteSidebar, type RouteStopItem } from "~/components/route-sidebar";
import { TollMap } from "~/components/toll-map";
import { evaluateRouteTolls, optimizeTollSplits } from "~/domain/toll-calculator";
import {
  TollDatasetSchema,
  VEHICLE_CLASS_META,
  type BypassDetour,
  type PlaceSuggestion,
  type RunEntryExitOverride,
  type TollDataset,
  type VehicleClass,
} from "~/domain/toll-types";
import { computeBypassSegment, computeDualRoutes } from "~/server/routing";

const fetchTollDataset = async (): Promise<TollDataset> => {
  const response = await fetch("/data/tolls-fr-2026.json");
  if (!response.ok) {
    throw new Error(`Impossible de charger les tarifs péages (${response.status})`);
  }
  const json: unknown = await response.json();
  return TollDatasetSchema.parse(json);
};

let stopIdCounter = 0;

const HomePage = () => {
  const [hydrated, setHydrated] = createSignal(false);
  const [origin, setOrigin] = createSignal<PlaceSuggestion | null>(null);
  const [destination, setDestination] = createSignal<PlaceSuggestion | null>(null);
  const [stops, setStops] = createSignal<RouteStopItem[]>([]);
  const [vehicleClass, setVehicleClass] = createSignal<VehicleClass>("c1");
  const [splitPlazaIds, setSplitPlazaIds] = createSignal<Set<string>>(new Set());
  const [bypassedSectionIds, setBypassedSectionIds] = createSignal<Set<string>>(new Set());
  const [runOverrides, setRunOverrides] = createSignal<Record<string, RunEntryExitOverride>>({});
  const [bypassDetours, setBypassDetours] = createSignal<Record<string, BypassDetour>>({});
  const [loadingBypassIds, setLoadingBypassIds] = createSignal<Set<string>>(new Set());
  const [maxAddedMinutes, setMaxAddedMinutes] = createSignal(12);
  const [showTollFree, setShowTollFree] = createSignal(false);
  const [selectedSectionId, setSelectedSectionId] = createSignal<string | null>(null);
  const [litersPer100Km, setLitersPer100Km] = createSignal(
    VEHICLE_CLASS_META.c1.defaultLitersPer100Km,
  );
  const [fuelPricePerLiter, setFuelPricePerLiter] = createSignal(1.78);

  onMount(() => {
    setHydrated(true);
  });

  const activeStops = createMemo<PlaceSuggestion[]>(() =>
    stops()
      .map((stop) => stop.place)
      .filter((place): place is PlaceSuggestion => place !== null),
  );

  const datasetQuery = createQuery(() => ({
    queryKey: ["toll-dataset", "fr-2026"],
    queryFn: fetchTollDataset,
    enabled: hydrated(),
    staleTime: Infinity,
  }));

  const routeQuery = createQuery(() => {
    const from = origin();
    const to = destination();
    const waypoints = activeStops().map((stop) => ({ lon: stop.lon, lat: stop.lat }));
    const waypointsKey = waypoints.map((wp) => `${wp.lon},${wp.lat}`).join(";");

    return {
      queryKey: ["dual-routes", from?.lon, from?.lat, waypointsKey, to?.lon, to?.lat],
      queryFn: () => {
        if (!from || !to) {
          throw new Error("Sélectionnez un départ et une arrivée");
        }
        return computeDualRoutes({
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
    const _from = origin();
    const _to = destination();
    const _stopsKey = activeStops()
      .map((stop) => `${stop.lon},${stop.lat}`)
      .join(";");
    if (_from || _to || _stopsKey.length > 0) {
      routeGeneration += 1;
      setSplitPlazaIds(new Set<string>());
      setBypassedSectionIds(new Set<string>());
      setRunOverrides({});
      setBypassDetours({});
      setLoadingBypassIds(new Set<string>());
      setSelectedSectionId(null);
    }
  });

  const handleVehicleClassChange = (nextClass: VehicleClass) => {
    setVehicleClass(nextClass);
    setLitersPer100Km(VEHICLE_CLASS_META[nextClass].defaultLitersPer100Km);
  };

  const dataset = () => (datasetQuery.isSuccess ? datasetQuery.data : null);
  const routeData = () =>
    routeQuery.isSuccess && origin() && destination() ? routeQuery.data : null;

  const summary = createMemo(() => {
    const ds = dataset();
    const highway = routeData()?.highway;
    if (!ds || !highway) return null;
    return evaluateRouteTolls({
      dataset: ds,
      coordinates: highway.coordinates,
      vehicleClass: vehicleClass(),
      splitPlazaIds: splitPlazaIds(),
      bypassedSectionIds: bypassedSectionIds(),
      runOverrides: runOverrides(),
    });
  });

  const optimization = createMemo(() => {
    const ds = dataset();
    const currentSummary = summary();
    if (!ds || !currentSummary) return null;
    return optimizeTollSplits({
      dataset: ds,
      units: currentSummary.units,
      vehicleClass: vehicleClass(),
      maxAddedMinutes: maxAddedMinutes(),
    });
  });

  createEffect(() => {
    const currentSummary = summary();
    const highway = routeData()?.highway;
    if (!currentSummary || !highway) return;

    const cached = bypassDetours();
    const loading = loadingBypassIds();
    const generation = routeGeneration;
    const totalHighwayKm = highway.distanceMeters / 1000;
    const totalHighwayMinutes = highway.durationSeconds / 60;

    for (const section of currentSummary.sections) {
      if (!section.isBypassed) continue;
      if (cached[section.id] || loading.has(section.id)) continue;

      let fromPoint = { lon: section.fromPlaza.plaza.lon, lat: section.fromPlaza.plaza.lat };
      let toPoint = { lon: section.toPlaza.plaza.lon, lat: section.toPlaza.plaza.lat };

      if (section.kind === "open") {
        const startIdx = Math.max(0, section.fromPlaza.routeCoordIndex - 15);
        const endIdx = Math.min(
          highway.coordinates.length - 1,
          section.toPlaza.routeCoordIndex + 15,
        );
        const startCoord = highway.coordinates[startIdx];
        const endCoord = highway.coordinates[endIdx];
        if (startCoord && endCoord) {
          fromPoint = { lon: startCoord[0], lat: startCoord[1] };
          toPoint = { lon: endCoord[0], lat: endCoord[1] };
        }
      }

      setLoadingBypassIds((prev) => {
        const next = new Set(prev);
        next.add(section.id);
        return next;
      });

      void computeBypassSegment({
        data: { from: fromPoint, to: toPoint },
      })
        .then((detourRoute) => {
          if (generation !== routeGeneration) return;
          if (!detourRoute || detourRoute.coordinates.length < 2) return;

          const highwaySectionMinutes =
            section.kind === "open"
              ? 3
              : totalHighwayKm > 0
                ? (section.distanceKm / totalHighwayKm) * totalHighwayMinutes
                : (section.distanceKm / 115) * 60;
          const extraMinutes = Math.max(
            1,
            Math.round(detourRoute.durationSeconds / 60 - highwaySectionMinutes),
          );
          const extraDistanceKm =
            Math.round((detourRoute.distanceMeters / 1000 - section.distanceKm) * 10) / 10;

          setBypassDetours((prev) => ({
            ...prev,
            [section.id]: {
              sectionId: section.id,
              coordinates: detourRoute.coordinates,
              distanceMeters: detourRoute.distanceMeters,
              durationSeconds: detourRoute.durationSeconds,
              extraMinutes,
              extraDistanceKm,
            },
          }));
        })
        .catch(() => undefined)
        .finally(() => {
          if (generation !== routeGeneration) return;
          setLoadingBypassIds((prev) => {
            const next = new Set(prev);
            next.delete(section.id);
            return next;
          });
        });
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
      const index = prev.findIndex((stop) => stop.id === stopId);
      if (index === -1) return prev;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const current = next[index];
      const target = next[targetIndex];
      if (!current || !target) return prev;
      next[index] = target;
      next[targetIndex] = current;
      return next;
    });
  };

  const handleToggleSplitPlaza = (plazaId: string) => {
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
    const unit = summary()?.units.find((u) => u.id === runId && u.kind === "closed");
    setRunOverrides((prev) => {
      const current = prev[runId] ?? {};
      let nextExit = current.exitPlazaId;
      if (unit && unit.kind === "closed" && plazaId && nextExit) {
        const entryIdx = unit.plazas.findIndex((p) => p.plaza.id === plazaId);
        const exitIdx = unit.plazas.findIndex((p) => p.plaza.id === nextExit);
        if (entryIdx >= exitIdx) {
          nextExit = undefined;
        }
      }
      const nextEntry =
        unit && unit.kind === "closed" && plazaId === unit.plazas[0]?.plaza.id
          ? undefined
          : plazaId;
      if (!nextEntry && !nextExit) {
        const rest = { ...prev };
        delete rest[runId];
        return rest;
      }
      return { ...prev, [runId]: { entryPlazaId: nextEntry, exitPlazaId: nextExit } };
    });
  };

  const handleSetRunExit = (runId: string, plazaId: string | undefined) => {
    const unit = summary()?.units.find((u) => u.id === runId && u.kind === "closed");
    setRunOverrides((prev) => {
      const current = prev[runId] ?? {};
      let nextEntry = current.entryPlazaId;
      if (unit && unit.kind === "closed" && plazaId && nextEntry) {
        const entryIdx = unit.plazas.findIndex((p) => p.plaza.id === nextEntry);
        const exitIdx = unit.plazas.findIndex((p) => p.plaza.id === plazaId);
        if (exitIdx <= entryIdx) {
          nextEntry = undefined;
        }
      }
      const lastId =
        unit && unit.kind === "closed" ? unit.plazas[unit.plazas.length - 1]?.plaza.id : undefined;
      const nextExit = plazaId === lastId ? undefined : plazaId;
      if (!nextEntry && !nextExit) {
        const rest = { ...prev };
        delete rest[runId];
        return rest;
      }
      return { ...prev, [runId]: { entryPlazaId: nextEntry, exitPlazaId: nextExit } };
    });
  };

  const handleResetRunOverride = (runId: string) => {
    setRunOverrides((prev) => {
      if (!prev[runId]) return prev;
      const next = { ...prev };
      delete next[runId];
      return next;
    });
  };

  const handleToggleBypassSection = (sectionId: string) => {
    const section = summary()?.sections.find((item) => item.id === sectionId);
    if (section?.bypassRole === "before-entry") {
      handleSetRunEntry(section.runId, undefined);
      return;
    }
    if (section?.bypassRole === "after-exit") {
      handleSetRunExit(section.runId, undefined);
      return;
    }
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
    setBypassedSectionIds(new Set<string>());
    setRunOverrides({});
    setSplitPlazaIds(new Set(opt.splitPlazaIds));
  };

  const handleResetCustomizations = () => {
    setSplitPlazaIds(new Set<string>());
    setBypassedSectionIds(new Set<string>());
    setRunOverrides({});
  };

  const handleSwapPlaces = () => {
    const currentOrigin = origin();
    const currentDestination = destination();
    setOrigin(currentDestination);
    setDestination(currentOrigin);
    setStops((prev) => [...prev].reverse());
  };

  const datasetStats = createMemo(() => {
    const ds = dataset();
    if (!ds) return null;
    return {
      plazaCount: ds.plazas.length,
      tariffCount: Object.keys(ds.tariffs).length,
      version: ds.version,
    };
  });

  return (
    <main class="flex h-dvh w-screen overflow-hidden bg-slate-950 text-slate-100">
      <RouteSidebar
        dataset={dataset()}
        datasetStats={datasetStats()}
        origin={origin()}
        destination={destination()}
        stops={stops()}
        onSelectOrigin={setOrigin}
        onClearOrigin={() => setOrigin(null)}
        onSelectDestination={setDestination}
        onClearDestination={() => setDestination(null)}
        onAddStop={handleAddStop}
        onSelectStop={handleSelectStop}
        onClearStop={handleClearStop}
        onRemoveStop={handleRemoveStop}
        onMoveStop={handleMoveStop}
        onSwapPlaces={handleSwapPlaces}
        onSelectPreset={(from, to) => {
          setOrigin(from);
          setDestination(to);
          setStops([]);
        }}
        vehicleClass={vehicleClass()}
        onChangeVehicleClass={handleVehicleClassChange}
        isLoadingRoute={
          (routeQuery.isFetching || datasetQuery.isFetching) &&
          !summary() &&
          Boolean(origin() && destination())
        }
        routeError={
          routeQuery.error instanceof Error
            ? routeQuery.error.message
            : datasetQuery.error instanceof Error
              ? datasetQuery.error.message
              : null
        }
        highwayRoute={routeData()?.highway ?? null}
        tollFreeRoute={routeData()?.tollFree ?? null}
        showTollFree={showTollFree()}
        onToggleShowTollFree={() => setShowTollFree((v) => !v)}
        summary={summary()}
        runOverrides={runOverrides()}
        onSetRunEntry={handleSetRunEntry}
        onSetRunExit={handleSetRunExit}
        onResetRunOverride={handleResetRunOverride}
        bypassDetours={bypassDetours()}
        loadingBypassIds={loadingBypassIds()}
        optimization={optimization()}
        maxAddedMinutes={maxAddedMinutes()}
        onChangeMaxAddedMinutes={setMaxAddedMinutes}
        onApplyOptimization={handleApplyOptimization}
        onResetCustomizations={handleResetCustomizations}
        splitPlazaIds={splitPlazaIds()}
        onToggleSplitPlaza={handleToggleSplitPlaza}
        onToggleBypassSection={handleToggleBypassSection}
        selectedSectionId={selectedSectionId()}
        onSelectSection={setSelectedSectionId}
        litersPer100Km={litersPer100Km()}
        onChangeLitersPer100Km={setLitersPer100Km}
        fuelPricePerLiter={fuelPricePerLiter()}
        onChangeFuelPricePerLiter={setFuelPricePerLiter}
      />

      <section class="relative flex-1">
        <TollMap
          origin={origin()}
          destination={destination()}
          stops={activeStops()}
          highwayRoute={routeData()?.highway ?? null}
          tollFreeRoute={routeData()?.tollFree ?? null}
          showTollFree={showTollFree()}
          units={summary()?.units ?? []}
          sections={summary()?.sections ?? []}
          runOverrides={runOverrides()}
          onSetRunEntry={handleSetRunEntry}
          onSetRunExit={handleSetRunExit}
          bypassDetours={bypassDetours()}
          loadingBypassIds={loadingBypassIds()}
          splitPlazaIds={splitPlazaIds()}
          selectedSectionId={selectedSectionId()}
          onToggleSplitPlaza={handleToggleSplitPlaza}
          onSelectSection={setSelectedSectionId}
        />
      </section>
    </main>
  );
};

export const Route = createFileRoute("/")({
  component: HomePage,
});
