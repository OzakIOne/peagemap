import {
  ArrowUpDown,
  Bike,
  Car,
  ChevronDown,
  ChevronUp,
  Loader2,
  Map as MapIcon,
  Plus,
  RotateCcw,
  Route,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Truck,
  Zap,
} from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import { computeEffectiveRouteMetrics } from "~/domain/toll-calculator";
import {
  VEHICLE_CLASS_META,
  type BypassDetour,
  type BypassDetourState,
  type ClosedTollRun,
  type OptimizationProfile,
  type OptimizationResult,
  type PlaceSuggestion,
  type PricedRouteSummary,
  type RouteGeometry,
  type RunEntryExitOverride,
  type TollDataset,
  type VehicleClass,
} from "~/domain/toll-types";
import { PRESET_TRIPS, formatDuration, formatEur, formatKm } from "~/lib/format";
import type { RouteExportInput } from "~/lib/route-export";
import { PlaceInput } from "./place-input";
import { RouteExportBar } from "./route-export-bar";
import { SmartSplitsTab } from "./smart-splits-tab";
import { TollSectionsTab } from "./toll-sections-tab";

export interface RouteStopItem {
  id: string;
  place: PlaceSuggestion | null;
}

export type MobileSheetMode = "peek" | "half" | "full";

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
  hasTelepeage: boolean;
  onToggleTelepeage: () => void;
  splitExtraMinutes: number;
  isLoadingRoute: boolean;
  isFetchingRoute: boolean;
  isLoadingTollFree: boolean;
  routeError: string | null;
  highwayRoute: RouteGeometry | null;
  tollFreeRoute: RouteGeometry | null;
  showTollFree: boolean;
  onSetShowTollFree: (show: boolean) => void;
  summary: PricedRouteSummary | null;
  runOverrides: Readonly<Record<string, RunEntryExitOverride>>;
  onSetRunEntry: (runId: string, plazaId: string | undefined) => void;
  onSetRunExit: (runId: string, plazaId: string | undefined) => void;
  onResetRunOverride: (runId: string) => void;
  bypassStates: Readonly<Record<string, BypassDetourState>>;
  optimization: OptimizationResult | null;
  maxAddedMinutes: number;
  onChangeMaxAddedMinutes: (minutes: number) => void;
  onApplyOptimization: () => void;
  onApplyProfile: (profile: OptimizationProfile) => void;
  activeProfile: OptimizationProfile | null;
  onResetCustomizations: () => void;
  splitPlazaIds: ReadonlySet<string>;
  onToggleSplitPlaza: (plazaId: string) => void;
  onToggleBypassSection: (sectionId: string) => void;
  onRetryBypassSection: (sectionId: string) => void;
  selectedSectionId: string | null;
  hoveredSectionId: string | null;
  scrollToSelectedToken: number;
  onSelectSection: (sectionId: string) => void;
  onHoverSection: (sectionId: string | null) => void;
  onCopyShareLink: () => Promise<boolean>;
  mobileSheetMode: MobileSheetMode;
  onChangeMobileSheetMode: (mode: MobileSheetMode) => void;
}

const PROFILE_OPTIONS: Array<{ id: OptimizationProfile; label: string }> = [
  { id: "fast", label: "Rapide" },
  { id: "balanced", label: "Équilibré" },
  { id: "eco", label: "Éco" },
  { id: "free", label: "0 €" },
];

export const RouteSidebar = (props: RouteSidebarProps) => {
  const [activeTab, setActiveTab] = createSignal<"sections" | "splits">("sections");

  const highwayKm = () => (props.highwayRoute ? props.highwayRoute.distanceMeters / 1000 : 0);
  const highwayMinutes = () => (props.highwayRoute ? props.highwayRoute.durationSeconds / 60 : 0);
  const tollFreeKm = () => (props.tollFreeRoute ? props.tollFreeRoute.distanceMeters / 1000 : 0);
  const tollFreeMinutes = () =>
    props.tollFreeRoute ? props.tollFreeRoute.durationSeconds / 60 : 0;

  const effectiveMetrics = () => {
    const summary = props.summary;
    if (!summary) return { addedMinutes: 0, addedDistanceKm: 0 };
    return computeEffectiveRouteMetrics({
      summary,
      bypassStates: props.bypassStates,
      splitExtraMinutes: props.splitExtraMinutes,
    });
  };

  const closedRuns = (): ClosedTollRun[] =>
    (props.summary?.units ?? []).filter((unit): unit is ClosedTollRun => unit.kind === "closed");

  const hasCustomizations = () => {
    const summary = props.summary;
    if (!summary) return false;
    return (
      summary.splitCount > 0 ||
      summary.bypassCount > 0 ||
      Object.keys(props.runOverrides).length > 0
    );
  };

  const hasManualBypasses = () => {
    const summary = props.summary;
    if (!summary) return false;
    return summary.bypassCount > 0 || Object.keys(props.runOverrides).length > 0;
  };

  const readyBypassDetours = (): Record<string, BypassDetour> => {
    const out: Record<string, BypassDetour> = {};
    for (const [id, state] of Object.entries(props.bypassStates)) {
      if (state.status === "ready") {
        out[id] = state.detour;
      }
    }
    return out;
  };

  const exportInput = (): RouteExportInput | null => {
    if (!props.origin || !props.destination || !props.highwayRoute || !props.summary) {
      return null;
    }
    const route =
      props.showTollFree && props.tollFreeRoute ? props.tollFreeRoute : props.highwayRoute;
    const validStops = props.stops
      .map((stop) => stop.place)
      .filter((place): place is PlaceSuggestion => place !== null);
    return {
      origin: props.origin,
      destination: props.destination,
      stops: validStops,
      route,
      units: props.summary.units,
      sections: props.summary.sections,
      bypassDetours: readyBypassDetours(),
      splitPlazaIds: props.splitPlazaIds,
      avoidTolls: props.showTollFree,
    };
  };

  const cycleMobileSheet = () => {
    const current = props.mobileSheetMode;
    if (current === "peek") props.onChangeMobileSheetMode("half");
    else if (current === "half") props.onChangeMobileSheetMode("full");
    else props.onChangeMobileSheetMode("peek");
  };

  const mobileHeightClass = () => {
    const mode = props.mobileSheetMode;
    if (mode === "peek") return "h-[136px]";
    if (mode === "half") return "h-[58dvh]";
    return "h-[92dvh]";
  };

  return (
    <aside
      class={`fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-slate-800/90 bg-slate-950/96 shadow-2xl backdrop-blur-xl transition-[height] duration-200 ease-out lg:static lg:h-full lg:w-[416px] lg:shrink-0 lg:rounded-none lg:border-r lg:border-t-0 ${mobileHeightClass()}`}
    >
      {/* Mobile drag/toggle handle */}
      <button
        type="button"
        onClick={cycleMobileSheet}
        aria-label="Ajuster la hauteur du panneau"
        class="flex shrink-0 flex-col items-center gap-1 pt-2 pb-1 lg:hidden"
      >
        <span class="h-1 w-10 rounded-full bg-slate-700" />
      </button>

      {/* Header */}
      <header class="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800/80 px-4 py-2.5 lg:py-3">
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-emerald-500 text-slate-950 shadow-lg shadow-sky-500/20">
            <Route class="h-4.5 w-4.5" />
          </div>
          <div>
            <h1 class="text-sm font-bold tracking-tight text-white">PeageMap</h1>
            <p class="text-[11px] tabular-nums text-slate-400">
              <Show when={props.datasetStats} fallback="Chargement tarifs 2026…">
                {(stats) =>
                  `${stats().plazaCount} gares · ${stats().tariffCount.toLocaleString("fr-FR")} tarifs`
                }
              </Show>
            </p>
          </div>
        </div>

        <div class="flex items-center gap-1.5">
          <Show when={props.isFetchingRoute && props.summary}>
            <Loader2 class="h-3.5 w-3.5 animate-spin text-sky-400" />
          </Show>

          <Show when={hasCustomizations()}>
            <button
              type="button"
              onClick={() => props.onResetCustomizations()}
              title="Réinitialiser toutes les personnalisations"
              class="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-300 transition-[border-color,color,transform] duration-150 hover:border-slate-500 hover:text-white active:scale-[0.97]"
            >
              <RotateCcw class="h-3 w-3" />
              <span>Réinitialiser</span>
            </button>
          </Show>

          <button
            type="button"
            onClick={() =>
              props.onChangeMobileSheetMode(props.mobileSheetMode === "peek" ? "half" : "peek")
            }
            class="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-sky-300 lg:hidden"
          >
            <Show
              when={props.mobileSheetMode === "peek"}
              fallback={
                <>
                  <MapIcon class="h-3 w-3" />
                  <span>Carte</span>
                </>
              }
            >
              <span>Détails</span>
              <ChevronUp class="h-3 w-3" />
            </Show>
          </button>
        </div>
      </header>

      {/* Mobile compact summary bar when in peek mode */}
      <Show when={props.mobileSheetMode === "peek" && props.summary}>
        {(summary) => (
          <button
            type="button"
            onClick={() => props.onChangeMobileSheetMode("half")}
            class="flex items-center justify-between px-4 py-2 text-left lg:hidden"
          >
            <div class="min-w-0">
              <div class="truncate text-xs font-semibold text-slate-100">
                {props.origin?.label} → {props.destination?.label}
              </div>
              <div class="text-[11px] tabular-nums text-slate-400">
                {formatDuration(highwayMinutes() + effectiveMetrics().addedMinutes)} ·{" "}
                {formatKm(Math.max(0, highwayKm() + effectiveMetrics().addedDistanceKm))}
              </div>
            </div>
            <div class="shrink-0 text-right tabular-nums">
              <div class="text-sm font-bold text-emerald-300">
                {props.showTollFree ? "0,00 €" : formatEur(summary().currentTollEur)}
              </div>
              <Show when={!props.showTollFree && summary().savingsEur > 0}>
                <div class="text-[10px] font-semibold text-emerald-400">
                  -{formatEur(summary().savingsEur)}
                </div>
              </Show>
            </div>
          </button>
        )}
      </Show>

      {/* Scrollable main content */}
      <div
        class={`app-scroller flex-1 space-y-4 overflow-y-auto px-4 py-3.5 ${
          props.mobileSheetMode === "peek" ? "hidden lg:block" : "block"
        }`}
      >
        {/* Search inputs */}
        <section class="space-y-2">
          <div class="space-y-2">
            <PlaceInput
              label="Départ (A)"
              placeholder="Ex : Paris, Lyon, Lille…"
              dotColorClass="bg-sky-500"
              badgeText="A"
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
                  <div class="flex shrink-0 flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={index() === 0}
                      aria-label="Monter l’étape"
                      onClick={() => props.onMoveStop(stop.id, "up")}
                      class="rounded-md border border-slate-800 bg-slate-900 p-1 text-slate-400 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-30"
                    >
                      <ChevronUp class="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={index() === props.stops.length - 1}
                      aria-label="Descendre l’étape"
                      onClick={() => props.onMoveStop(stop.id, "down")}
                      class="rounded-md border border-slate-800 bg-slate-900 p-1 text-slate-400 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-30"
                    >
                      <ChevronDown class="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Supprimer l’étape"
                      onClick={() => props.onRemoveStop(stop.id)}
                      class="rounded-md border border-slate-800 bg-slate-900 p-1 text-slate-400 transition-colors hover:border-rose-500/60 hover:text-rose-300"
                    >
                      <Trash2 class="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
            </For>

            <PlaceInput
              label="Arrivée (B)"
              placeholder="Ex : Marseille, Bordeaux, Nice…"
              dotColorClass="bg-rose-500"
              badgeText="B"
              value={props.destination}
              onSelect={(place) => props.onSelectDestination(place)}
              onClear={() => props.onClearDestination()}
            />
          </div>

          <div class="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => props.onAddStop()}
              disabled={props.stops.length >= 8}
              class="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition-[border-color,color,transform] duration-150 hover:border-indigo-500/60 hover:text-indigo-200 active:scale-[0.97] disabled:opacity-40"
            >
              <Plus class="h-3.5 w-3.5 text-indigo-400" />
              Ajouter une étape
            </button>

            <button
              type="button"
              onClick={() => props.onSwapPlaces()}
              disabled={!props.origin && !props.destination}
              aria-label="Inverser départ et arrivée"
              class="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition-[border-color,color,transform] duration-150 hover:border-slate-600 hover:text-white active:scale-[0.97] disabled:opacity-40"
            >
              <ArrowUpDown class="h-3.5 w-3.5" />
              Inverser
            </button>
          </div>
        </section>

        {/* Vehicle class + Télépéage */}
        <section class="space-y-2">
          <div class="grid grid-cols-3 gap-1.5 rounded-xl border border-slate-800 bg-slate-900/70 p-1">
            <For each={["c1", "c2", "c5"] as const}>
              {(cls) => {
                const active = () => props.vehicleClass === cls;
                const meta = VEHICLE_CLASS_META[cls];
                return (
                  <button
                    type="button"
                    onClick={() => props.onChangeVehicleClass(cls)}
                    title={meta.description}
                    class={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
                      active()
                        ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/50"
                        : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                    }`}
                  >
                    <Show when={cls === "c1"}>
                      <Car class="h-3.5 w-3.5" />
                    </Show>
                    <Show when={cls === "c2"}>
                      <Truck class="h-3.5 w-3.5" />
                    </Show>
                    <Show when={cls === "c5"}>
                      <Bike class="h-3.5 w-3.5" />
                    </Show>
                    <span>{meta.shortLabel}</span>
                  </button>
                );
              }}
            </For>
          </div>

          <button
            type="button"
            onClick={() => props.onToggleTelepeage()}
            class={`flex w-full items-center justify-between rounded-xl border px-3 py-1.5 text-[11px] font-medium transition-[border-color,background-color,color] duration-150 ${
              props.hasTelepeage
                ? "border-emerald-500/45 bg-emerald-950/30 text-emerald-200"
                : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
            }`}
          >
            <span class="flex items-center gap-1.5">
              <Zap
                class={`h-3.5 w-3.5 ${props.hasTelepeage ? "text-emerald-400" : "text-slate-500"}`}
              />
              <span>Badge Télépéage</span>
            </span>
            <span class="tabular-nums text-[10px]">
              {props.hasTelepeage ? "Actif (~2 min/sortie)" : "Sans badge (~4 min/sortie)"}
            </span>
          </button>
        </section>

        {/* Empty state with presets */}
        <Show when={!props.origin || !props.destination}>
          <div class="space-y-3 rounded-2xl border border-dashed border-slate-800 bg-slate-900/35 p-4 text-center">
            <div class="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sky-400">
              <Route class="h-5 w-5" />
            </div>
            <div>
              <p class="text-sm font-semibold text-slate-200">Planifiez votre trajet autoroutier</p>
              <p class="mt-1 text-xs leading-relaxed text-slate-400">
                Choisissez un départ et une arrivée, ou cliquez droit sur la carte pour poser un
                point.
              </p>
            </div>
            <div class="flex flex-wrap justify-center gap-1.5 pt-1">
              <For each={PRESET_TRIPS}>
                {(preset) => (
                  <button
                    type="button"
                    onClick={() => props.onSelectPreset(preset.origin, preset.destination)}
                    class="rounded-full border border-slate-800 bg-slate-900/90 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-[border-color,color,transform] duration-150 hover:border-sky-500/60 hover:text-sky-200 active:scale-[0.97]"
                  >
                    {preset.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Loading / Error */}
        <Show when={props.isLoadingRoute}>
          <div class="flex items-center justify-center gap-2.5 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-xs text-slate-300">
            <Loader2 class="h-4 w-4 animate-spin text-sky-400" />
            Calcul de l’itinéraire et détection des péages…
          </div>
        </Show>

        <Show when={props.routeError}>
          {(err) => (
            <div class="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
              {err()}
            </div>
          )}
        </Show>

        {/* Active route analysis */}
        <Show when={props.highwayRoute ? props.summary : null}>
          {(summary) => (
            <div class="space-y-3.5">
              {/* Hero Comparator */}
              <section class="space-y-2">
                <div class="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      props.onSetShowTollFree(false);
                      props.onResetCustomizations();
                    }}
                    class={`rounded-xl border p-2.5 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.98] ${
                      !props.showTollFree && !hasCustomizations()
                        ? "border-sky-400/60 bg-sky-950/30"
                        : "border-slate-800 bg-slate-900/70 hover:border-sky-500/40"
                    }`}
                  >
                    <div class="text-[10px] font-semibold uppercase text-slate-400">Direct</div>
                    <div class="mt-1 text-sm font-bold tabular-nums text-sky-300">
                      {formatEur(summary().directTollEur)}
                    </div>
                    <div class="text-[10px] text-slate-500">Péage direct</div>
                    <div class="mt-1.5 border-t border-slate-800 pt-1 text-[10px] tabular-nums text-slate-400">
                      {formatDuration(highwayMinutes())} · {formatKm(highwayKm())}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => props.onSetShowTollFree(false)}
                    class={`rounded-xl border p-2.5 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.98] ${
                      !props.showTollFree && hasCustomizations()
                        ? "border-emerald-400/70 bg-emerald-950/35"
                        : "border-emerald-500/35 bg-emerald-950/20 hover:border-emerald-400/60"
                    }`}
                  >
                    <div class="text-[10px] font-semibold uppercase text-emerald-300">
                      Votre trajet
                    </div>
                    <div class="mt-1 text-sm font-bold tabular-nums text-emerald-300">
                      {formatEur(summary().currentTollEur)}
                    </div>
                    <div class="text-[10px] tabular-nums text-emerald-200/80">
                      <Show when={summary().savingsEur > 0} fallback="Identique au direct">
                        -{formatEur(summary().savingsEur)} (-{summary().savingsPercent}%)
                      </Show>
                    </div>
                    <div class="mt-1.5 border-t border-emerald-500/20 pt-1 text-[10px] tabular-nums text-slate-300">
                      {formatDuration(highwayMinutes() + effectiveMetrics().addedMinutes)} ·{" "}
                      {formatKm(Math.max(0, highwayKm() + effectiveMetrics().addedDistanceKm))}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => props.onSetShowTollFree(!props.showTollFree)}
                    class={`rounded-xl border p-2.5 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.98] ${
                      props.showTollFree
                        ? "border-violet-400/70 bg-violet-950/40"
                        : "border-slate-800 bg-slate-900/70 hover:border-violet-500/40"
                    }`}
                  >
                    <div class="text-[10px] font-semibold uppercase text-violet-300">
                      Sans péage
                    </div>
                    <div class="mt-1 text-sm font-bold tabular-nums text-violet-200">0,00 €</div>
                    <div class="text-[10px] tabular-nums text-slate-400">
                      <Show
                        when={!props.isLoadingTollFree}
                        fallback={
                          <span class="inline-flex items-center gap-1">
                            <Loader2 class="h-2.5 w-2.5 animate-spin" />
                            Calcul…
                          </span>
                        }
                      >
                        <Show when={props.tollFreeRoute} fallback="Indisponible">
                          {summary().directTollEur > 0
                            ? `-${formatEur(summary().directTollEur)}`
                            : "Gratuit"}
                        </Show>
                      </Show>
                    </div>
                    <div class="mt-1.5 border-t border-slate-800 pt-1 text-[10px] tabular-nums text-slate-400">
                      <Show when={props.tollFreeRoute} fallback="—">
                        {formatDuration(tollFreeMinutes())} · {formatKm(tollFreeKm())}
                      </Show>
                    </div>
                  </button>
                </div>

                {/* Quick objective mode selector */}
                <div class="grid grid-cols-4 gap-1 rounded-xl border border-slate-800/90 bg-slate-900/60 p-1">
                  <For each={PROFILE_OPTIONS}>
                    {(profile) => {
                      const isActive = () => props.activeProfile === profile.id;
                      return (
                        <button
                          type="button"
                          onClick={() => props.onApplyProfile(profile.id)}
                          class={`rounded-lg px-2 py-1 text-[11px] font-semibold transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
                            isActive()
                              ? profile.id === "free"
                                ? "bg-violet-500/25 text-violet-200 ring-1 ring-violet-400/50"
                                : profile.id === "fast"
                                  ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/50"
                                  : "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/50"
                              : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                          }`}
                        >
                          {profile.label}
                        </button>
                      );
                    }}
                  </For>
                </div>
              </section>

              {/* 2 clean tabs: Sections & Détours | Sorties malines */}
              <div class="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("sections")}
                  class={`flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors ${
                    activeTab() === "sections"
                      ? "bg-slate-800 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <SlidersHorizontal class="h-3.5 w-3.5 text-sky-400" />
                  <span>Sections ({summary().sections.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("splits")}
                  class={`flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors ${
                    activeTab() === "splits"
                      ? "bg-slate-800 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Scissors class="h-3.5 w-3.5 text-emerald-400" />
                  <span>Sorties malines</span>
                  <Show when={summary().splitCount > 0}>
                    <span class="rounded-full bg-emerald-500/25 px-1.5 py-0.25 text-[10px] font-bold tabular-nums text-emerald-300">
                      {summary().splitCount}
                    </span>
                  </Show>
                </button>
              </div>

              <Show when={activeTab() === "sections"}>
                <TollSectionsTab
                  closedRuns={closedRuns()}
                  sections={summary().sections}
                  runOverrides={props.runOverrides}
                  bypassStates={props.bypassStates}
                  selectedSectionId={props.selectedSectionId}
                  hoveredSectionId={props.hoveredSectionId}
                  scrollToSelectedToken={props.scrollToSelectedToken}
                  onSetRunEntry={props.onSetRunEntry}
                  onSetRunExit={props.onSetRunExit}
                  onResetRunOverride={props.onResetRunOverride}
                  onToggleBypassSection={props.onToggleBypassSection}
                  onRetryBypassSection={props.onRetryBypassSection}
                  onSelectSection={props.onSelectSection}
                  onHoverSection={props.onHoverSection}
                />
              </Show>

              <Show when={activeTab() === "splits"}>
                <SmartSplitsTab
                  dataset={props.dataset}
                  closedRuns={closedRuns()}
                  vehicleClass={props.vehicleClass}
                  splitExtraMinutes={props.splitExtraMinutes}
                  hasTelepeage={props.hasTelepeage}
                  optimization={props.optimization}
                  maxAddedMinutes={props.maxAddedMinutes}
                  onChangeMaxAddedMinutes={props.onChangeMaxAddedMinutes}
                  onApplyOptimization={props.onApplyOptimization}
                  splitPlazaIds={props.splitPlazaIds}
                  onToggleSplitPlaza={props.onToggleSplitPlaza}
                  runOverrides={props.runOverrides}
                  hasManualBypasses={hasManualBypasses()}
                />
              </Show>
            </div>
          )}
        </Show>
      </div>

      {/* Sticky Export Footer */}
      <Show when={props.mobileSheetMode !== "peek"}>
        <RouteExportBar exportInput={exportInput()} onCopyShareLink={props.onCopyShareLink} />
      </Show>
    </aside>
  );
};
