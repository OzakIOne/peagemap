import {
  ArrowUpDown,
  Car,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Fuel,
  Loader2,
  MapPin,
  Navigation,
  Plus,
  RotateCcw,
  Route,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Truck,
} from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import {
  SPLIT_EXTRA_KM,
  SPLIT_EXTRA_MINUTES,
  computeSectionHourlyRateEur,
  estimateFuelCostEur,
  evaluateIntermediateSplitCandidates,
  resolveRunEntryExitIndices,
} from "~/domain/toll-calculator";
import {
  VEHICLE_CLASS_META,
  type BypassDetour,
  type ClosedTollRun,
  type OptimizationResult,
  type PlaceSuggestion,
  type PricedRouteSummary,
  type RouteGeometry,
  type RunEntryExitOverride,
  type TollDataset,
  type VehicleClass,
} from "~/domain/toll-types";
import { PRESET_TRIPS, formatDuration, formatEur, formatKm } from "~/lib/format";
import {
  buildAppleMapsUrl,
  buildGoogleMapsUrl,
  buildWazeUrl,
  collectOrderedExportWaypoints,
  downloadGpxFile,
  type RouteExportInput,
} from "~/lib/route-export";
import { PlaceInput } from "./place-input";

export interface RouteStopItem {
  id: string;
  place: PlaceSuggestion | null;
}

interface RouteSidebarProps {
  dataset: TollDataset | null;
  datasetStats: { plazaCount: number; tariffCount: number; version: string } | null;
  origin: PlaceSuggestion | null;
  destination: PlaceSuggestion | null;
  stops: RouteStopItem[];
  onSelectOrigin: (place: PlaceSuggestion) => void;
  onClearOrigin: () => void;
  onSelectDestination: (place: PlaceSuggestion) => void;
  onClearDestination: () => void;
  onAddStop: () => void;
  onSelectStop: (stopId: string, place: PlaceSuggestion) => void;
  onClearStop: (stopId: string) => void;
  onRemoveStop: (stopId: string) => void;
  onMoveStop: (stopId: string, direction: "up" | "down") => void;
  onSwapPlaces: () => void;
  onSelectPreset: (origin: PlaceSuggestion, destination: PlaceSuggestion) => void;
  vehicleClass: VehicleClass;
  onChangeVehicleClass: (vehicleClass: VehicleClass) => void;
  isLoadingRoute: boolean;
  routeError: string | null;
  highwayRoute: RouteGeometry | null;
  tollFreeRoute: RouteGeometry | null;
  showTollFree: boolean;
  onToggleShowTollFree: () => void;
  summary: PricedRouteSummary | null;
  runOverrides: Readonly<Record<string, RunEntryExitOverride>>;
  onSetRunEntry: (runId: string, plazaId: string | undefined) => void;
  onSetRunExit: (runId: string, plazaId: string | undefined) => void;
  onResetRunOverride: (runId: string) => void;
  bypassDetours: Readonly<Record<string, BypassDetour>>;
  loadingBypassIds: ReadonlySet<string>;
  optimization: OptimizationResult | null;
  maxAddedMinutes: number;
  onChangeMaxAddedMinutes: (minutes: number) => void;
  onApplyOptimization: () => void;
  onResetCustomizations: () => void;
  splitPlazaIds: ReadonlySet<string>;
  onToggleSplitPlaza: (plazaId: string) => void;
  onToggleBypassSection: (sectionId: string) => void;
  selectedSectionId: string | null;
  onSelectSection: (sectionId: string) => void;
  litersPer100Km: number;
  onChangeLitersPer100Km: (value: number) => void;
  fuelPricePerLiter: number;
  onChangeFuelPricePerLiter: (value: number) => void;
}

export const RouteSidebar = (props: RouteSidebarProps) => {
  const [collapsedRunIds, setCollapsedRunIds] = createSignal<Set<string>>(new Set());
  const [onlyProfitableSplits, setOnlyProfitableSplits] = createSignal(true);
  const [showFuelSettings, setShowFuelSettings] = createSignal(false);

  const toggleRunCollapsed = (runId: string) => {
    setCollapsedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  const highwayKm = () => (props.highwayRoute ? props.highwayRoute.distanceMeters / 1000 : 0);
  const highwayMinutes = () => (props.highwayRoute ? props.highwayRoute.durationSeconds / 60 : 0);

  const effectiveAddedMinutes = () => {
    const summary = props.summary;
    if (!summary) return 0;
    let total = summary.splitCount * SPLIT_EXTRA_MINUTES;
    for (const section of summary.sections) {
      if (!section.isBypassed) continue;
      const detour = props.bypassDetours[section.id];
      total += detour ? detour.extraMinutes : section.bypassExtraMinutes;
    }
    return Math.round(total);
  };

  const effectiveAddedDistanceKm = () => {
    const summary = props.summary;
    if (!summary) return 0;
    let total = summary.splitCount * SPLIT_EXTRA_KM;
    for (const section of summary.sections) {
      if (!section.isBypassed) continue;
      const detour = props.bypassDetours[section.id];
      total += detour
        ? detour.extraDistanceKm
        : section.kind === "open"
          ? 3.5
          : Math.round(section.distanceKm * 0.12 * 10) / 10;
    }
    return Math.round(total * 10) / 10;
  };

  const directFuelEur = () =>
    estimateFuelCostEur({
      distanceKm: highwayKm(),
      litersPer100Km: props.litersPer100Km,
      fuelPricePerLiterEur: props.fuelPricePerLiter,
    });

  const currentFuelEur = () =>
    estimateFuelCostEur({
      distanceKm: Math.max(0, highwayKm() + effectiveAddedDistanceKm()),
      litersPer100Km: props.litersPer100Km,
      fuelPricePerLiterEur: props.fuelPricePerLiter,
    });

  const tollFreeKm = () => (props.tollFreeRoute ? props.tollFreeRoute.distanceMeters / 1000 : 0);
  const tollFreeMinutes = () =>
    props.tollFreeRoute ? props.tollFreeRoute.durationSeconds / 60 : 0;
  const tollFreeFuelEur = () =>
    estimateFuelCostEur({
      distanceKm: tollFreeKm(),
      litersPer100Km: props.litersPer100Km,
      fuelPricePerLiterEur: props.fuelPricePerLiter,
    });

  const closedRuns = (): ClosedTollRun[] =>
    (props.summary?.units ?? []).filter((unit): unit is ClosedTollRun => unit.kind === "closed");

  const activeStops = (): PlaceSuggestion[] =>
    props.stops
      .map((stop) => stop.place)
      .filter((place): place is PlaceSuggestion => place !== null);

  const exportInput = (): RouteExportInput | null => {
    if (!props.origin || !props.destination) return null;
    const useTollFree = props.showTollFree && Boolean(props.tollFreeRoute);
    const activeRoute = useTollFree ? props.tollFreeRoute : props.highwayRoute;
    if (!activeRoute) return null;

    const allSectionsBypassed =
      Boolean(props.summary) &&
      (props.summary?.sections.length ?? 0) > 0 &&
      (props.summary?.sections.every((section) => section.isBypassed) ?? false);

    return {
      origin: props.origin,
      destination: props.destination,
      stops: activeStops(),
      route: activeRoute,
      units: props.summary?.units ?? [],
      sections: props.summary?.sections ?? [],
      bypassDetours: props.bypassDetours,
      splitPlazaIds: props.splitPlazaIds,
      avoidTolls: useTollFree || allSectionsBypassed,
    };
  };

  return (
    <aside class="z-20 flex h-full w-full max-w-[420px] flex-col border-r border-slate-800/90 bg-slate-950/94 backdrop-blur-xl">
      <header class="flex items-center justify-between border-b border-slate-800/80 px-4 py-3">
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500 text-slate-950 shadow-lg shadow-sky-500/20">
            <Route class="h-4.5 w-4.5" />
          </div>
          <div>
            <h1 class="text-sm font-bold tracking-tight text-slate-100">PeageMap</h1>
            <p class="text-[11px] text-slate-400">
              <Show when={props.datasetStats} fallback="Chargement tarifs 2026…">
                {(stats) =>
                  `${stats().plazaCount} gares · ${stats().tariffCount.toLocaleString("fr-FR")} tarifs 2026`
                }
              </Show>
            </p>
          </div>
        </div>
        <Show when={(props.summary?.splitCount ?? 0) > 0 || (props.summary?.bypassCount ?? 0) > 0}>
          <button
            type="button"
            onClick={() => props.onResetCustomizations()}
            class="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
          >
            <RotateCcw class="h-3 w-3" />
            Direct
          </button>
        </Show>
      </header>

      <div class="flex-1 overflow-y-auto px-4 py-3.5">
        <section class="space-y-2">
          <div class="space-y-2">
            <PlaceInput
              label="Départ (A)"
              placeholder="Ex : Paris, Lyon, Lille…"
              dotColorClass="bg-sky-400"
              value={props.origin}
              onSelect={(place) => props.onSelectOrigin(place)}
              onClear={() => props.onClearOrigin()}
            />

            <For each={props.stops}>
              {(stop, index) => (
                <div class="flex items-center gap-1.5">
                  <div class="min-w-0 flex-1">
                    <PlaceInput
                      label={`Étape ${index() + 1}`}
                      placeholder="Ex : Dijon, Beaune, Valence…"
                      dotColorClass="bg-indigo-500"
                      badgeText={String(index() + 1)}
                      value={stop.place}
                      onSelect={(place) => props.onSelectStop(stop.id, place)}
                      onClear={() => props.onClearStop(stop.id)}
                    />
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <button
                      type="button"
                      aria-label={`Monter l'étape ${index() + 1}`}
                      disabled={index() === 0}
                      onClick={() => props.onMoveStop(stop.id, "up")}
                      class="rounded-md border border-slate-800 bg-slate-900 p-1 text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ChevronUp class="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Descendre l'étape ${index() + 1}`}
                      disabled={index() === props.stops.length - 1}
                      onClick={() => props.onMoveStop(stop.id, "down")}
                      class="rounded-md border border-slate-800 bg-slate-900 p-1 text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ChevronDown class="h-3 w-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label={`Supprimer l'étape ${index() + 1}`}
                    onClick={() => props.onRemoveStop(stop.id)}
                    class="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 transition-colors hover:border-rose-500/60 hover:bg-rose-950/40 hover:text-rose-300"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </For>

            <PlaceInput
              label="Arrivée (B)"
              placeholder="Ex : Marseille, Bordeaux, Nice…"
              dotColorClass="bg-rose-400"
              value={props.destination}
              onSelect={(place) => props.onSelectDestination(place)}
              onClear={() => props.onClearDestination()}
            />
          </div>

          <div class="flex items-center justify-between gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => props.onAddStop()}
              disabled={props.stops.length >= 8}
              class="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-700 bg-slate-900/60 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-indigo-400/70 hover:bg-indigo-950/30 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus class="h-3.5 w-3.5" />
              Ajouter une étape
            </button>

            <button
              type="button"
              aria-label="Inverser départ et arrivée"
              onClick={() => props.onSwapPlaces()}
              disabled={!props.origin && !props.destination && props.stops.length === 0}
              class="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-sky-500/60 hover:text-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowUpDown class="h-3.5 w-3.5" />
              Inverser
            </button>
          </div>

          <div class="flex flex-wrap gap-1.5 pt-1">
            <For each={PRESET_TRIPS}>
              {(preset) => (
                <button
                  type="button"
                  onClick={() => props.onSelectPreset(preset.origin, preset.destination)}
                  class="rounded-full border border-slate-800 bg-slate-900/80 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:border-sky-500/50 hover:bg-slate-800 hover:text-white"
                >
                  {preset.label}
                </button>
              )}
            </For>
          </div>
        </section>

        <section class="mt-3.5">
          <div class="grid grid-cols-3 gap-1.5 rounded-xl border border-slate-800 bg-slate-900/70 p-1">
            <For each={["c1", "c2", "c5"] as VehicleClass[]}>
              {(cls) => {
                const active = () => props.vehicleClass === cls;
                return (
                  <button
                    type="button"
                    onClick={() => props.onChangeVehicleClass(cls)}
                    class={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all ${
                      active()
                        ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/50"
                        : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                    }`}
                  >
                    <Show when={cls === "c1"}>
                      <Car class="h-3.5 w-3.5" />
                    </Show>
                    <Show when={cls === "c2"}>
                      <Truck class="h-3.5 w-3.5" />
                    </Show>
                    <span>{VEHICLE_CLASS_META[cls].shortLabel}</span>
                  </button>
                );
              }}
            </For>
          </div>
        </section>

        <Show when={!props.origin || !props.destination}>
          <div class="mt-4 rounded-2xl border border-slate-800/90 bg-slate-900/50 p-4 text-center">
            <div class="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
              <MapPin class="h-4.5 w-4.5" />
            </div>
            <p class="mt-2.5 text-xs font-semibold text-slate-200">
              Planifiez votre trajet autoroutier
            </p>
            <p class="mt-1 text-[11px] leading-relaxed text-slate-400">
              Saisissez un départ, une arrivée (et vos étapes si besoin) ou choisissez un trajet
              rapide ci-dessus pour calculer et optimiser chaque section de péage.
            </p>
          </div>
        </Show>

        <Show when={props.isLoadingRoute}>
          <div class="mt-4 flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 py-6 text-xs text-slate-300">
            <Loader2 class="h-4 w-4 animate-spin text-sky-400" />
            Calcul de l’itinéraire et détection des péages…
          </div>
        </Show>

        <Show when={props.routeError}>
          {(err) => (
            <div class="mt-4 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
              {err()}
            </div>
          )}
        </Show>

        <Show when={props.highwayRoute && !props.isLoadingRoute ? props.summary : null}>
          {(summary) => {
            const opt = () => props.optimization;

            return (
              <div class="mt-4 space-y-4">
                <section class="rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-950/45 to-slate-900/80 p-3.5">
                  <div class="flex items-start justify-between gap-2">
                    <div>
                      <div class="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                        <Sparkles class="h-3.5 w-3.5" />
                        Auto-optimisation du fractionnement
                      </div>
                      <p class="mt-0.5 text-[11px] text-slate-400">
                        Trouve les meilleures sorties/ré-entrées sur la matrice tarifaire.
                      </p>
                    </div>
                    <Show when={opt() && opt()!.savingsEur > 0}>
                      <span class="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">
                        -{formatEur(opt()!.savingsEur)}
                      </span>
                    </Show>
                  </div>

                  <div class="mt-3">
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="text-slate-400">Temps supplémentaire accepté</span>
                      <span class="font-semibold text-slate-200">
                        +{props.maxAddedMinutes} min (max{" "}
                        {Math.floor(props.maxAddedMinutes / SPLIT_EXTRA_MINUTES)} sorties)
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="32"
                      step="4"
                      value={props.maxAddedMinutes}
                      onInput={(event) =>
                        props.onChangeMaxAddedMinutes(Number(event.currentTarget.value))
                      }
                      class="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-emerald-400"
                    />
                  </div>

                  <div class="mt-3 flex items-center justify-between gap-2">
                    <Show
                      when={opt() && opt()!.savingsEur > 0}
                      fallback={
                        <span class="text-[11px] text-slate-400">
                          Aucun fractionnement rentable sur ce budget temps.
                        </span>
                      }
                    >
                      <div class="text-[11px] text-emerald-200/90">
                        <strong>{opt()!.splitPlazaIds.length}</strong> sortie
                        {opt()!.splitPlazaIds.length > 1 ? "s" : ""} (+{opt()!.addedMinutes} min ·{" "}
                        <strong>{formatEur(opt()!.savingsPerHourEur)}/h</strong>)
                      </div>
                      <button
                        type="button"
                        onClick={() => props.onApplyOptimization()}
                        class="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-emerald-400"
                      >
                        Appliquer
                      </button>
                    </Show>
                  </div>
                </section>

                <section class="space-y-2">
                  <div class="flex items-center justify-between">
                    <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Comparateur Direct / Optimisé / Sans péage
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShowFuelSettings((v) => !v)}
                      class="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
                    >
                      <Fuel class="h-3 w-3" />
                      Carburant
                    </button>
                  </div>

                  <Show when={showFuelSettings()}>
                    <div class="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-2.5 text-xs">
                      <label class="space-y-1">
                        <span class="text-[10px] text-slate-400">Conso (L/100 km)</span>
                        <input
                          type="number"
                          step="0.5"
                          min="1"
                          max="25"
                          value={props.litersPer100Km}
                          onInput={(event) =>
                            props.onChangeLitersPer100Km(
                              Math.max(1, Number(event.currentTarget.value) || 6.5),
                            )
                          }
                          class="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                        />
                      </label>
                      <label class="space-y-1">
                        <span class="text-[10px] text-slate-400">Prix (€/L)</span>
                        <input
                          type="number"
                          step="0.05"
                          min="0.5"
                          max="4"
                          value={props.fuelPricePerLiter}
                          onInput={(event) =>
                            props.onChangeFuelPricePerLiter(
                              Math.max(0.5, Number(event.currentTarget.value) || 1.78),
                            )
                          }
                          class="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                        />
                      </label>
                    </div>
                  </Show>

                  <div class="grid grid-cols-3 gap-2">
                    <div class="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
                      <div class="text-[10px] font-semibold uppercase text-slate-400">Direct</div>
                      <div class="mt-1 text-sm font-bold text-sky-300">
                        {formatEur(summary().directTollEur)}
                      </div>
                      <div class="text-[10px] text-slate-400">
                        Total {formatEur(summary().directTollEur + directFuelEur())}
                      </div>
                      <div class="mt-1.5 border-t border-slate-800 pt-1 text-[10px] text-slate-400">
                        {formatDuration(highwayMinutes())} · {formatKm(highwayKm())}
                      </div>
                    </div>

                    <div class="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-2.5">
                      <div class="text-[10px] font-semibold uppercase text-emerald-300">
                        Votre trajet
                      </div>
                      <div class="mt-1 text-sm font-bold text-emerald-300">
                        {formatEur(summary().currentTollEur)}
                      </div>
                      <div class="text-[10px] text-emerald-200/80">
                        <Show
                          when={summary().savingsEur > 0}
                          fallback={`Total ${formatEur(summary().currentTollEur + currentFuelEur())}`}
                        >
                          -{formatEur(summary().savingsEur)} (-{summary().savingsPercent}%)
                        </Show>
                      </div>
                      <div class="mt-1.5 border-t border-emerald-500/20 pt-1 text-[10px] text-slate-300">
                        {formatDuration(highwayMinutes() + effectiveAddedMinutes())} ·{" "}
                        {formatKm(Math.max(0, highwayKm() + effectiveAddedDistanceKm()))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => props.onToggleShowTollFree()}
                      class={`rounded-xl border p-2.5 text-left transition-colors ${
                        props.showTollFree
                          ? "border-violet-400/60 bg-violet-950/35"
                          : "border-slate-800 bg-slate-900/70 hover:border-violet-500/40"
                      }`}
                    >
                      <div class="text-[10px] font-semibold uppercase text-violet-300">
                        Sans péage
                      </div>
                      <div class="mt-1 text-sm font-bold text-violet-200">0,00 €</div>
                      <div class="text-[10px] text-slate-400">
                        <Show when={props.tollFreeRoute} fallback="Indisponible">
                          Total {formatEur(tollFreeFuelEur())}
                        </Show>
                      </div>
                      <div class="mt-1.5 border-t border-slate-800 pt-1 text-[10px] text-slate-400">
                        <Show when={props.tollFreeRoute} fallback="—">
                          {formatDuration(tollFreeMinutes())} · {formatKm(tollFreeKm())}
                        </Show>
                      </div>
                    </button>
                  </div>
                </section>

                <Show when={exportInput()}>
                  {(payload) => {
                    const waypoints = () => collectOrderedExportWaypoints(payload());
                    const stopCount = () =>
                      waypoints().filter((waypoint) => waypoint.kind === "stop").length;
                    const splitExportCount = () =>
                      waypoints().filter((waypoint) => waypoint.kind === "split").length;
                    const bypassExportCount = () =>
                      waypoints().filter((waypoint) => waypoint.kind === "bypass").length;
                    const exportSummaryLabel = () => {
                      if (payload().avoidTolls) {
                        return stopCount() > 0
                          ? `Sans péage · ${stopCount()} étape${stopCount() > 1 ? "s" : ""}`
                          : "Mode sans péage";
                      }
                      const parts: string[] = [];
                      if (stopCount() > 0) {
                        parts.push(`${stopCount()} étape${stopCount() > 1 ? "s" : ""}`);
                      }
                      if (splitExportCount() > 0) {
                        parts.push(
                          `${splitExportCount()} sortie${splitExportCount() > 1 ? "s" : ""} péage`,
                        );
                      }
                      if (bypassExportCount() > 0) {
                        parts.push(
                          `${bypassExportCount()} détour${bypassExportCount() > 1 ? "s" : ""}`,
                        );
                      }
                      return parts.length > 0 ? `Inclut ${parts.join(" + ")}` : "Trajet direct";
                    };

                    return (
                      <section class="space-y-2 rounded-2xl border border-slate-800/90 bg-slate-900/60 p-3">
                        <div class="flex items-center justify-between gap-2">
                          <div class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
                            <Navigation class="h-3.5 w-3.5 text-sky-400" />
                            Exporter l’itinéraire
                          </div>
                          <span class="text-[10px] font-medium text-slate-400">
                            {exportSummaryLabel()}
                          </span>
                        </div>

                        <div class="grid grid-cols-2 gap-1.5">
                          <a
                            href={buildGoogleMapsUrl(payload())}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="flex items-center justify-between rounded-xl border border-slate-700/80 bg-slate-950/80 px-2.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-sky-500/60 hover:bg-slate-900 hover:text-white"
                          >
                            <span>Google Maps</span>
                            <ExternalLink class="h-3.5 w-3.5 text-sky-400" />
                          </a>

                          <a
                            href={buildAppleMapsUrl(payload())}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="flex items-center justify-between rounded-xl border border-slate-700/80 bg-slate-950/80 px-2.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-sky-500/60 hover:bg-slate-900 hover:text-white"
                          >
                            <span>Apple Plans</span>
                            <ExternalLink class="h-3.5 w-3.5 text-slate-300" />
                          </a>

                          <a
                            href={buildWazeUrl(payload())}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={
                              waypoints().length > 0
                                ? "Waze ouvre uniquement la destination finale via lien web"
                                : "Ouvrir la navigation dans Waze"
                            }
                            class="flex items-center justify-between rounded-xl border border-slate-700/80 bg-slate-950/80 px-2.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-500/60 hover:bg-slate-900 hover:text-white"
                          >
                            <span>Waze</span>
                            <ExternalLink class="h-3.5 w-3.5 text-cyan-400" />
                          </a>

                          <button
                            type="button"
                            onClick={() => downloadGpxFile(payload())}
                            class="flex items-center justify-between rounded-xl border border-emerald-500/40 bg-emerald-950/35 px-2.5 py-2 text-xs font-medium text-emerald-200 transition-colors hover:border-emerald-400/70 hover:bg-emerald-900/40 hover:text-white"
                          >
                            <span>Fichier GPX</span>
                            <Download class="h-3.5 w-3.5 text-emerald-400" />
                          </button>
                        </div>

                        <Show when={waypoints().length > 0}>
                          <p class="text-[10px] text-slate-500">
                            Google Maps, Apple Plans et GPX incluent vos étapes et sorties péage.
                            Waze n’accepte que la destination via lien.
                          </p>
                        </Show>
                      </section>
                    );
                  }}
                </Show>

                <section class="space-y-2.5">
                  <div class="flex items-center justify-between">
                    <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Sections de péage ({summary().sections.length})
                    </h2>
                    <span class="text-[11px] text-slate-500">Choisissez où entrer / sortir</span>
                  </div>

                  <Show when={closedRuns().length > 0}>
                    <div class="space-y-2">
                      <For each={closedRuns()}>
                        {(run) => {
                          const indices = () =>
                            resolveRunEntryExitIndices({
                              run,
                              override: props.runOverrides[run.id],
                            });
                          const isCustom = () =>
                            indices().entryIdx > 0 || indices().exitIdx < run.plazas.length - 1;
                          const totalSpan = () => Math.max(1, run.plazas.length - 1);
                          const prePct = () => (indices().entryIdx / totalSpan()) * 100;
                          const activePct = () =>
                            ((indices().exitIdx - indices().entryIdx) / totalSpan()) * 100;
                          const postPct = () =>
                            ((totalSpan() - indices().exitIdx) / totalSpan()) * 100;

                          return (
                            <Show when={run.plazas.length >= 3}>
                              <div class="rounded-xl border border-slate-800/90 bg-slate-900/75 p-2.5">
                                <div class="flex items-center justify-between gap-2">
                                  <div class="text-[11px] font-semibold text-slate-200">
                                    Portion autoroute · {run.concessionaire} (
                                    {run.highways.join(" / ")})
                                  </div>
                                  <Show when={isCustom()}>
                                    <button
                                      type="button"
                                      onClick={() => props.onResetRunOverride(run.id)}
                                      class="text-[10px] font-semibold text-sky-400 hover:text-sky-300"
                                    >
                                      Toute l’autoroute
                                    </button>
                                  </Show>
                                </div>

                                <div class="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                                  <Show when={prePct() > 0}>
                                    <div
                                      style={{ width: `${prePct()}%` }}
                                      class="bg-amber-400/80 transition-all"
                                      title="Hors péage avant l'entrée choisie"
                                    />
                                  </Show>
                                  <div
                                    style={{ width: `${activePct()}%` }}
                                    class="bg-sky-400 transition-all"
                                    title="Portion sur autoroute"
                                  />
                                  <Show when={postPct() > 0}>
                                    <div
                                      style={{ width: `${postPct()}%` }}
                                      class="bg-amber-400/80 transition-all"
                                      title="Hors péage après la sortie choisie"
                                    />
                                  </Show>
                                </div>

                                <div class="mt-2 grid grid-cols-2 gap-2">
                                  <label class="space-y-1">
                                    <span class="block text-[10px] font-medium text-slate-400">
                                      Entrer à
                                    </span>
                                    <select
                                      aria-label={`Entrer sur ${run.concessionaire}`}
                                      value={run.plazas[indices().entryIdx]?.plaza.id ?? ""}
                                      onChange={(event) =>
                                        props.onSetRunEntry(run.id, event.currentTarget.value)
                                      }
                                      class="w-full truncate rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] font-medium text-slate-100 focus:border-sky-500 focus:outline-none"
                                    >
                                      <For each={run.plazas.slice(0, indices().exitIdx)}>
                                        {(item, idx) => (
                                          <option value={item.plaza.id}>
                                            {idx() === 0
                                              ? `${item.plaza.name} (début)`
                                              : `${item.plaza.name} (${item.plaza.highway})`}
                                          </option>
                                        )}
                                      </For>
                                    </select>
                                  </label>

                                  <label class="space-y-1">
                                    <span class="block text-[10px] font-medium text-slate-400">
                                      Sortir à
                                    </span>
                                    <select
                                      aria-label={`Sortir de ${run.concessionaire}`}
                                      value={run.plazas[indices().exitIdx]?.plaza.id ?? ""}
                                      onChange={(event) =>
                                        props.onSetRunExit(run.id, event.currentTarget.value)
                                      }
                                      class="w-full truncate rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] font-medium text-slate-100 focus:border-sky-500 focus:outline-none"
                                    >
                                      <For each={run.plazas.slice(indices().entryIdx + 1)}>
                                        {(item, idx) => {
                                          const isLast =
                                            indices().entryIdx + 1 + idx() ===
                                            run.plazas.length - 1;
                                          return (
                                            <option value={item.plaza.id}>
                                              {isLast
                                                ? `${item.plaza.name} (fin)`
                                                : `${item.plaza.name} (${item.plaza.highway})`}
                                            </option>
                                          );
                                        }}
                                      </For>
                                    </select>
                                  </label>
                                </div>
                              </div>
                            </Show>
                          );
                        }}
                      </For>
                    </div>
                  </Show>

                  <Show
                    when={summary().sections.length > 0}
                    fallback={
                      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-400">
                        Aucune section de péage détectée sur cet itinéraire.
                      </div>
                    }
                  >
                    <div class="space-y-2.5">
                      <For each={summary().sections}>
                        {(section) => {
                          const isSelected = () => props.selectedSectionId === section.id;
                          const detour = () => props.bypassDetours[section.id];
                          const isLoadingDetour = () =>
                            section.isBypassed && props.loadingBypassIds.has(section.id);
                          const savedMinutes = () =>
                            detour()?.extraMinutes ?? section.bypassExtraMinutes;
                          const hourlyRateEur = () =>
                            computeSectionHourlyRateEur({
                              priceEur: section.basePriceEur,
                              savedMinutes: savedMinutes(),
                            });
                          const isExactRate = () => Boolean(detour());

                          return (
                            <div
                              onClick={() => props.onSelectSection(section.id)}
                              class={`cursor-pointer rounded-xl border p-3 transition-all ${
                                section.isBypassed
                                  ? "border-amber-400/55 bg-amber-950/25"
                                  : isSelected()
                                    ? "border-sky-400/70 bg-slate-900"
                                    : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                              }`}
                            >
                              <div class="flex items-start justify-between gap-2">
                                <div class="min-w-0 flex-1">
                                  <div class="flex flex-wrap items-center gap-1.5">
                                    <span class="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-300">
                                      {section.highway}
                                    </span>
                                    <span class="text-[10px] font-medium text-slate-400">
                                      {section.concessionaire}
                                    </span>
                                    <Show when={section.isSplitStart || section.isSplitEnd}>
                                      <span class="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                                        Fractionné
                                      </span>
                                    </Show>
                                    <Show when={section.isBypassed}>
                                      <span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                                        Hors péage
                                      </span>
                                    </Show>
                                  </div>
                                  <div class="mt-1 truncate text-xs font-semibold text-slate-100">
                                    <Show
                                      when={section.kind === "closed"}
                                      fallback={`Barrière : ${section.fromPlaza.plaza.name}`}
                                    >
                                      {section.fromPlaza.plaza.name} → {section.toPlaza.plaza.name}
                                    </Show>
                                  </div>
                                  <div class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-400">
                                    <Show
                                      when={section.kind === "closed"}
                                      fallback={<span>Système ouvert</span>}
                                    >
                                      <span>{formatKm(section.distanceKm)}</span>
                                      <Show
                                        when={
                                          section.basePriceEur !== null && section.distanceKm > 0
                                        }
                                      >
                                        <span>
                                          ·{" "}
                                          {(section.basePriceEur! / section.distanceKm).toFixed(2)}{" "}
                                          €/km
                                        </span>
                                      </Show>
                                    </Show>
                                    <Show when={hourlyRateEur()}>
                                      {(rate) => (
                                        <span
                                          title={`Prendre cette section autoroute revient à ${isExactRate() ? "" : "~"}${formatEur(rate())} par heure gagnée par rapport au contournement hors péage`}
                                          class={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                            rate() >= 25
                                              ? "bg-amber-500/15 text-amber-300"
                                              : "bg-slate-800 text-slate-300"
                                          }`}
                                        >
                                          {isExactRate() ? "" : "~"}
                                          {formatEur(rate())}/h gagnée
                                        </span>
                                      )}
                                    </Show>
                                  </div>
                                </div>

                                <div class="flex shrink-0 flex-col items-end">
                                  <Show
                                    when={section.isBypassed}
                                    fallback={
                                      <span class="text-sm font-bold text-slate-100">
                                        {section.basePriceEur !== null
                                          ? formatEur(section.basePriceEur)
                                          : "N/C"}
                                      </span>
                                    }
                                  >
                                    <span class="text-sm font-bold text-amber-300">0,00 €</span>
                                    <Show when={section.basePriceEur !== null}>
                                      <span class="text-[10px] text-slate-500 line-through">
                                        {formatEur(section.basePriceEur!)}
                                      </span>
                                    </Show>
                                  </Show>
                                </div>
                              </div>

                              <div class="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
                                <Show
                                  when={section.isBypassed}
                                  fallback={
                                    <span class="text-[11px] text-slate-400">
                                      Gain autoroute : ~{savedMinutes()} min
                                    </span>
                                  }
                                >
                                  <Show
                                    when={!isLoadingDetour()}
                                    fallback={
                                      <span class="flex items-center gap-1.5 text-[11px] text-amber-300">
                                        <Loader2 class="h-3 w-3 animate-spin" />
                                        Calcul du contournement…
                                      </span>
                                    }
                                  >
                                    <span class="text-[11px] font-medium text-amber-200/90">
                                      Détour : +{savedMinutes()} min
                                      <Show when={detour()}>
                                        {(d) =>
                                          ` · ${d().extraDistanceKm >= 0 ? "+" : ""}${d().extraDistanceKm.toFixed(1)} km`
                                        }
                                      </Show>
                                    </span>
                                  </Show>
                                </Show>

                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    props.onToggleBypassSection(section.id);
                                  }}
                                  class={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                    section.isBypassed
                                      ? "border border-amber-400/50 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                                      : "border border-slate-700 bg-slate-800/90 text-slate-200 hover:border-amber-400/60 hover:bg-amber-950/40 hover:text-amber-200"
                                  }`}
                                >
                                  {section.isBypassed
                                    ? "Reprendre l’autoroute"
                                    : "Contourner hors péage"}
                                </button>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </section>

                <Show when={closedRuns().length > 0 && props.dataset}>
                  <section class="space-y-2.5 pb-4">
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <div class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
                          <SlidersHorizontal class="h-3.5 w-3.5 text-emerald-400" />
                          Sorties intermédiaires (fractionnement)
                        </div>
                        <p class="mt-0.5 text-[11px] text-slate-400">
                          Sortir puis rerentrer au même péage (+{SPLIT_EXTRA_MINUTES} min) pour
                          payer moins cher.
                        </p>
                      </div>
                    </div>

                    <div class="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-900/70 p-1">
                      <button
                        type="button"
                        onClick={() => setOnlyProfitableSplits(true)}
                        class={`rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                          onlyProfitableSplits()
                            ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        Rentables uniquement
                      </button>
                      <button
                        type="button"
                        onClick={() => setOnlyProfitableSplits(false)}
                        class={`rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                          !onlyProfitableSplits()
                            ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        Toutes les sorties
                      </button>
                    </div>

                    <For each={closedRuns()}>
                      {(run) => {
                        const insights = () =>
                          props.dataset
                            ? evaluateIntermediateSplitCandidates({
                                dataset: props.dataset,
                                run,
                                vehicleClass: props.vehicleClass,
                                splitPlazaIds: props.splitPlazaIds,
                                override: props.runOverrides[run.id],
                              })
                            : [];
                        const profitableCount = () =>
                          insights().filter(
                            (item) => (item.savingsEur ?? 0) > 0.05 || item.isActive,
                          ).length;
                        const visibleInsights = () =>
                          onlyProfitableSplits()
                            ? insights().filter(
                                (item) => (item.savingsEur ?? 0) > 0.05 || item.isActive,
                              )
                            : insights();
                        const isCollapsed = () => collapsedRunIds().has(run.id);
                        const activeSplitsInRun = () =>
                          insights().filter((item) => item.isActive).length;

                        return (
                          <Show when={insights().length > 0}>
                            <div class="rounded-xl border border-slate-800 bg-slate-900/50">
                              <button
                                type="button"
                                onClick={() => toggleRunCollapsed(run.id)}
                                class="flex w-full items-center justify-between px-3 py-2.5 text-left"
                              >
                                <div>
                                  <div class="text-xs font-semibold text-slate-200">
                                    {run.concessionaire} ({run.highways.join(" / ")})
                                  </div>
                                  <div class="text-[11px] text-slate-400">
                                    <span class="text-emerald-300">
                                      {profitableCount()} rentable
                                      {profitableCount() > 1 ? "s" : ""}
                                    </span>{" "}
                                    sur {insights().length} · {activeSplitsInRun()} active
                                    {activeSplitsInRun() > 1 ? "s" : ""}
                                  </div>
                                </div>
                                <Show
                                  when={!isCollapsed()}
                                  fallback={<ChevronDown class="h-4 w-4 text-slate-400" />}
                                >
                                  <ChevronUp class="h-4 w-4 text-slate-400" />
                                </Show>
                              </button>

                              <Show when={!isCollapsed()}>
                                <div class="max-h-64 space-y-1 overflow-y-auto border-t border-slate-800 p-2">
                                  <Show
                                    when={visibleInsights().length > 0}
                                    fallback={
                                      <div class="px-2 py-2 text-center text-[11px] text-slate-400">
                                        Aucune sortie rentable sur ce tronçon. Cliquez « Toutes les
                                        sorties » pour les voir quand même.
                                      </div>
                                    }
                                  >
                                    <For each={visibleInsights()}>
                                      {(item) => {
                                        const isProfitable = () => (item.savingsEur ?? 0) > 0.05;
                                        return (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              props.onToggleSplitPlaza(item.matched.plaza.id)
                                            }
                                            class={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                                              item.isActive
                                                ? "bg-emerald-500/20 text-emerald-100 ring-1 ring-emerald-500/50"
                                                : isProfitable()
                                                  ? "bg-slate-900/90 text-slate-200 hover:bg-emerald-950/40"
                                                  : "text-slate-400 hover:bg-slate-800/70"
                                            }`}
                                          >
                                            <div class="min-w-0 flex-1">
                                              <div class="truncate font-medium">
                                                {item.matched.plaza.name}
                                              </div>
                                              <div class="text-[10px] text-slate-500">
                                                {item.matched.plaza.highway}
                                                {item.matched.plaza.exitNumber
                                                  ? ` · n°${item.matched.plaza.exitNumber}`
                                                  : ""}
                                                <Show when={item.savingsPerHourEur}>
                                                  {(rate) => ` · ${formatEur(rate())}/h`}
                                                </Show>
                                              </div>
                                            </div>

                                            <div class="flex shrink-0 items-center gap-2">
                                              <Show when={item.savingsEur !== null}>
                                                <span
                                                  class={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                                                    isProfitable()
                                                      ? "bg-emerald-500/20 text-emerald-300"
                                                      : "bg-slate-800 text-slate-400"
                                                  }`}
                                                >
                                                  {item.savingsEur! > 0
                                                    ? `-${formatEur(item.savingsEur!)}`
                                                    : item.savingsEur! < 0
                                                      ? `+${formatEur(Math.abs(item.savingsEur!))}`
                                                      : "0,00 €"}
                                                </span>
                                              </Show>
                                              <span
                                                class={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                                                  item.isActive
                                                    ? "bg-emerald-500 text-slate-950"
                                                    : "border border-slate-700 text-slate-300"
                                                }`}
                                              >
                                                <Scissors class="h-3 w-3" />
                                                {item.isActive ? "Actif" : "+4m"}
                                              </span>
                                            </div>
                                          </button>
                                        );
                                      }}
                                    </For>
                                  </Show>
                                </div>
                              </Show>
                            </div>
                          </Show>
                        );
                      }}
                    </For>
                  </section>
                </Show>
              </div>
            );
          }}
        </Show>
      </div>
    </aside>
  );
};
