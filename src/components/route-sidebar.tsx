import {
  ArrowUpDown,
  Car,
  ChevronDown,
  ChevronUp,
  Fuel,
  Loader2,
  RotateCcw,
  Route,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Truck,
} from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import { SPLIT_EXTRA_MINUTES, estimateFuelCostEur } from "~/domain/toll-calculator";
import {
  VEHICLE_CLASS_META,
  type ClosedTollRun,
  type OptimizationResult,
  type PlaceSuggestion,
  type PricedRouteSummary,
  type RouteGeometry,
  type VehicleClass,
} from "~/domain/toll-types";
import { PRESET_TRIPS, formatDuration, formatEur, formatKm } from "~/lib/format";
import { PlaceInput } from "./place-input";

interface RouteSidebarProps {
  datasetStats: { plazaCount: number; tariffCount: number; version: string } | null;
  origin: PlaceSuggestion | null;
  destination: PlaceSuggestion | null;
  onSelectOrigin: (place: PlaceSuggestion) => void;
  onSelectDestination: (place: PlaceSuggestion) => void;
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
  const [expandedRunIds, setExpandedRunIds] = createSignal<Set<string>>(new Set());
  const [showFuelSettings, setShowFuelSettings] = createSignal(false);

  const toggleRunExpanded = (runId: string) => {
    setExpandedRunIds((prev) => {
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

  const directFuelEur = () =>
    estimateFuelCostEur({
      distanceKm: highwayKm(),
      litersPer100Km: props.litersPer100Km,
      fuelPricePerLiterEur: props.fuelPricePerLiter,
    });

  const currentFuelEur = () =>
    estimateFuelCostEur({
      distanceKm: highwayKm() + (props.summary?.addedDistanceKm ?? 0),
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
          <div class="relative space-y-2">
            <PlaceInput
              label="Départ (A)"
              placeholder="Ex : Paris, Lyon, Lille…"
              dotColorClass="bg-sky-400"
              value={props.origin}
              onSelect={(place) => props.onSelectOrigin(place)}
            />
            <button
              type="button"
              aria-label="Inverser départ et arrivée"
              onClick={() => props.onSwapPlaces()}
              class="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-slate-300 shadow-md transition-colors hover:border-sky-500/60 hover:text-sky-300"
            >
              <ArrowUpDown class="h-3.5 w-3.5" />
            </button>
            <PlaceInput
              label="Arrivée (B)"
              placeholder="Ex : Marseille, Bordeaux, Nice…"
              dotColorClass="bg-rose-400"
              value={props.destination}
              onSelect={(place) => props.onSelectDestination(place)}
            />
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
                        {formatDuration(highwayMinutes() + summary().addedMinutes)} ·{" "}
                        {formatKm(highwayKm() + summary().addedDistanceKm)}
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

                <section class="space-y-2.5">
                  <div class="flex items-center justify-between">
                    <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Sections de péage ({summary().sections.length})
                    </h2>
                    <span class="text-[11px] text-slate-500">
                      Cliquez une sortie sur la carte ou ici
                    </span>
                  </div>

                  <Show
                    when={summary().sections.length > 0}
                    fallback={
                      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-400">
                        Aucune section de péage détectée sur cet itinéraire.
                      </div>
                    }
                  >
                    <div class="space-y-2">
                      <For each={summary().sections}>
                        {(section) => {
                          const isSelected = () => props.selectedSectionId === section.id;
                          return (
                            <div
                              onClick={() => props.onSelectSection(section.id)}
                              class={`cursor-pointer rounded-xl border p-3 transition-all ${
                                section.isBypassed
                                  ? "border-amber-500/40 bg-amber-950/20"
                                  : isSelected()
                                    ? "border-sky-400/70 bg-slate-900"
                                    : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                              }`}
                            >
                              <div class="flex items-start justify-between gap-2">
                                <div class="min-w-0 flex-1">
                                  <div class="flex items-center gap-1.5">
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
                                  </div>
                                  <div class="mt-1 truncate text-xs font-semibold text-slate-100">
                                    <Show
                                      when={section.kind === "closed"}
                                      fallback={`Barrière : ${section.fromPlaza.plaza.name}`}
                                    >
                                      {section.fromPlaza.plaza.name} → {section.toPlaza.plaza.name}
                                    </Show>
                                  </div>
                                  <div class="mt-0.5 text-[11px] text-slate-400">
                                    <Show
                                      when={section.kind === "closed"}
                                      fallback="Système ouvert"
                                    >
                                      {formatKm(section.distanceKm)}
                                      {section.basePriceEur !== null && section.distanceKm > 0
                                        ? ` · ${(section.basePriceEur / section.distanceKm).toFixed(2)} €/km`
                                        : ""}
                                    </Show>
                                  </div>
                                </div>

                                <div class="flex flex-col items-end gap-1.5">
                                  <span
                                    class={`text-sm font-bold ${
                                      section.isBypassed
                                        ? "text-amber-300 line-through"
                                        : "text-slate-100"
                                    }`}
                                  >
                                    {section.basePriceEur !== null
                                      ? formatEur(section.basePriceEur)
                                      : "N/C"}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      props.onToggleBypassSection(section.id);
                                    }}
                                    class={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                                      section.isBypassed
                                        ? "bg-amber-500 text-slate-950 hover:bg-amber-400"
                                        : "border border-slate-700 bg-slate-800/80 text-slate-300 hover:border-amber-400/60 hover:text-amber-200"
                                    }`}
                                  >
                                    {section.isBypassed
                                      ? `Évité (+${section.bypassExtraMinutes}m)`
                                      : "Éviter (0 €)"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </section>

                <Show when={closedRuns().length > 0}>
                  <section class="space-y-2 pb-4">
                    <div class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <SlidersHorizontal class="h-3.5 w-3.5" />
                      Modifier les sorties intermédiaires
                    </div>
                    <For each={closedRuns()}>
                      {(run) => {
                        const intermediatePlazas = () => run.plazas.slice(1, -1);
                        const isExpanded = () => expandedRunIds().has(run.id);
                        const activeSplitsInRun = () =>
                          intermediatePlazas().filter((m) => props.splitPlazaIds.has(m.plaza.id))
                            .length;

                        return (
                          <Show when={intermediatePlazas().length > 0}>
                            <div class="rounded-xl border border-slate-800 bg-slate-900/50">
                              <button
                                type="button"
                                onClick={() => toggleRunExpanded(run.id)}
                                class="flex w-full items-center justify-between px-3 py-2.5 text-left"
                              >
                                <div>
                                  <div class="text-xs font-semibold text-slate-200">
                                    {run.concessionaire} ({run.highways.join(" / ")})
                                  </div>
                                  <div class="text-[11px] text-slate-400">
                                    {intermediatePlazas().length} échangeurs ·{" "}
                                    <span class="text-emerald-300">
                                      {activeSplitsInRun()} sortie
                                      {activeSplitsInRun() > 1 ? "s" : ""} active
                                      {activeSplitsInRun() > 1 ? "s" : ""}
                                    </span>
                                  </div>
                                </div>
                                <Show
                                  when={isExpanded()}
                                  fallback={<ChevronDown class="h-4 w-4 text-slate-400" />}
                                >
                                  <ChevronUp class="h-4 w-4 text-slate-400" />
                                </Show>
                              </button>

                              <Show when={isExpanded()}>
                                <div class="max-h-64 space-y-1 overflow-y-auto border-t border-slate-800 p-2">
                                  <For each={intermediatePlazas()}>
                                    {(matched) => {
                                      const isSplit = () =>
                                        props.splitPlazaIds.has(matched.plaza.id);
                                      return (
                                        <button
                                          type="button"
                                          onClick={() => props.onToggleSplitPlaza(matched.plaza.id)}
                                          class={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                                            isSplit()
                                              ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40"
                                              : "text-slate-300 hover:bg-slate-800/80"
                                          }`}
                                        >
                                          <div class="min-w-0 flex-1 pr-2">
                                            <span class="truncate font-medium">
                                              {matched.plaza.name}
                                            </span>
                                            <span class="ml-1.5 text-[10px] text-slate-500">
                                              {matched.plaza.highway}
                                              {matched.plaza.exitNumber
                                                ? ` · n°${matched.plaza.exitNumber}`
                                                : ""}
                                            </span>
                                          </div>
                                          <span class="flex shrink-0 items-center gap-1 text-[10px] font-semibold">
                                            <Scissors class="h-3 w-3" />
                                            {isSplit() ? "Actif" : "Sortir"}
                                          </span>
                                        </button>
                                      );
                                    }}
                                  </For>
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
