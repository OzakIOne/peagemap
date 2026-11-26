import { createQuery } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { createEffect, createMemo, createSignal, onMount } from "solid-js";
import { RouteSidebar } from "~/components/route-sidebar";
import { TollMap } from "~/components/toll-map";
import { evaluateRouteTolls, optimizeTollSplits } from "~/domain/toll-calculator";
import {
  TollDatasetSchema,
  VEHICLE_CLASS_META,
  type PlaceSuggestion,
  type TollDataset,
  type VehicleClass,
} from "~/domain/toll-types";
import { PRESET_TRIPS } from "~/lib/format";
import { computeDualRoutes } from "~/server/routing";

const defaultPreset = PRESET_TRIPS[1] ?? PRESET_TRIPS[0];

const fetchTollDataset = async (): Promise<TollDataset> => {
  const response = await fetch("/data/tolls-fr-2026.json");
  if (!response.ok) {
    throw new Error(`Impossible de charger les tarifs péages (${response.status})`);
  }
  const json: unknown = await response.json();
  return TollDatasetSchema.parse(json);
};

const HomePage = () => {
  const [hydrated, setHydrated] = createSignal(false);
  const [origin, setOrigin] = createSignal<PlaceSuggestion | null>(defaultPreset?.origin ?? null);
  const [destination, setDestination] = createSignal<PlaceSuggestion | null>(
    defaultPreset?.destination ?? null,
  );
  const [vehicleClass, setVehicleClass] = createSignal<VehicleClass>("c1");
  const [splitPlazaIds, setSplitPlazaIds] = createSignal<Set<string>>(new Set());
  const [bypassedSectionIds, setBypassedSectionIds] = createSignal<Set<string>>(new Set());
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

  const datasetQuery = createQuery(() => ({
    queryKey: ["toll-dataset", "fr-2026"],
    queryFn: fetchTollDataset,
    enabled: hydrated(),
    staleTime: Infinity,
  }));

  const routeQuery = createQuery(() => {
    const from = origin();
    const to = destination();
    return {
      queryKey: ["dual-routes", from?.lon, from?.lat, to?.lon, to?.lat],
      queryFn: () => {
        if (!from || !to) {
          throw new Error("Sélectionnez un départ et une arrivée");
        }
        return computeDualRoutes({
          data: {
            origin: { lon: from.lon, lat: from.lat },
            destination: { lon: to.lon, lat: to.lat },
          },
        });
      },
      enabled: hydrated() && Boolean(from && to),
      staleTime: 10 * 60_000,
    };
  });

  createEffect(() => {
    const _from = origin();
    const _to = destination();
    if (_from || _to) {
      setSplitPlazaIds(new Set<string>());
      setBypassedSectionIds(new Set<string>());
      setSelectedSectionId(null);
    }
  });

  const handleVehicleClassChange = (nextClass: VehicleClass) => {
    setVehicleClass(nextClass);
    setLitersPer100Km(VEHICLE_CLASS_META[nextClass].defaultLitersPer100Km);
  };

  const dataset = () => (datasetQuery.isSuccess ? datasetQuery.data : null);
  const routeData = () => (routeQuery.isSuccess ? routeQuery.data : null);

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

  const handleToggleBypassSection = (sectionId: string) => {
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
    setSplitPlazaIds(new Set(opt.splitPlazaIds));
  };

  const handleResetCustomizations = () => {
    setSplitPlazaIds(new Set<string>());
    setBypassedSectionIds(new Set<string>());
  };

  const handleSwapPlaces = () => {
    const currentOrigin = origin();
    const currentDestination = destination();
    setOrigin(currentDestination);
    setDestination(currentOrigin);
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
        datasetStats={datasetStats()}
        origin={origin()}
        destination={destination()}
        onSelectOrigin={setOrigin}
        onSelectDestination={setDestination}
        onSwapPlaces={handleSwapPlaces}
        onSelectPreset={(from, to) => {
          setOrigin(from);
          setDestination(to);
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
          highwayRoute={routeData()?.highway ?? null}
          tollFreeRoute={routeData()?.tollFree ?? null}
          showTollFree={showTollFree()}
          units={summary()?.units ?? []}
          sections={summary()?.sections ?? []}
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
