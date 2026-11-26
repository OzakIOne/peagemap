import { Check, ChevronDown, ChevronUp, Scissors, Sparkles } from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import { evaluateIntermediateSplitCandidates } from "~/domain/toll-calculator";
import type {
  ClosedTollRun,
  OptimizationResult,
  RunEntryExitOverride,
  TollDataset,
  VehicleClass,
} from "~/domain/toll-types";
import { formatEur } from "~/lib/format";
import { InfoTooltip } from "./info-tooltip";

interface SmartSplitsTabProps {
  dataset: TollDataset | null;
  closedRuns: ClosedTollRun[];
  vehicleClass: VehicleClass;
  splitExtraMinutes: number;
  hasTelepeage: boolean;
  optimization: OptimizationResult | null;
  maxAddedMinutes: number;
  onChangeMaxAddedMinutes: (minutes: number) => void;
  onApplyOptimization: () => void;
  splitPlazaIds: ReadonlySet<string>;
  onToggleSplitPlaza: (plazaId: string) => void;
  runOverrides: Readonly<Record<string, RunEntryExitOverride>>;
  hasManualBypasses: boolean;
}

export const SmartSplitsTab = (props: SmartSplitsTabProps) => {
  const [collapsedRunIds, setCollapsedRunIds] = createSignal<Set<string>>(new Set());
  const [onlyProfitableSplits, setOnlyProfitableSplits] = createSignal(true);

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

  const isOptimizationApplied = () => {
    const opt = props.optimization;
    if (!opt || opt.splitPlazaIds.length === 0) return false;
    if (props.splitPlazaIds.size !== opt.splitPlazaIds.length) return false;
    return opt.splitPlazaIds.every((id) => props.splitPlazaIds.has(id));
  };

  const stepMinutes = () => props.splitExtraMinutes;
  const maxSliderMinutes = () => props.splitExtraMinutes * 8;

  return (
    <div class="space-y-3 pb-4">
      <section class="rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-950/45 to-slate-900/80 p-3.5">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
            <Sparkles class="h-3.5 w-3.5" />
            <span>Optimisation auto (sortie/ré-entrée)</span>
            <InfoTooltip
              label="Explication de l'optimisation automatique"
              text={`Cherche les meilleures sorties/ré-entrées sur l’autoroute pour payer moins de péage. Estimation : +${props.splitExtraMinutes} min par sortie${props.hasTelepeage ? " (avec badge télépéage)" : " (barrière + demi-tour)"}.`}
            />
          </div>
          <Show when={props.optimization && props.optimization.savingsEur > 0}>
            <span class="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold tabular-nums text-emerald-300">
              -{formatEur(props.optimization!.savingsEur)}
            </span>
          </Show>
        </div>

        <div class="mt-2.5">
          <div class="flex items-center justify-between text-[11px] tabular-nums">
            <span class="text-slate-400">
              Temps max accepté (~{props.splitExtraMinutes} min/sortie)
            </span>
            <span class="font-semibold text-slate-200">
              +{props.maxAddedMinutes} min (max{" "}
              {Math.floor(props.maxAddedMinutes / Math.max(1, props.splitExtraMinutes))})
            </span>
          </div>
          <input
            type="range"
            min="0"
            max={maxSliderMinutes()}
            step={stepMinutes()}
            value={props.maxAddedMinutes}
            onInput={(event) => props.onChangeMaxAddedMinutes(Number(event.currentTarget.value))}
            class="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-emerald-400"
          />
        </div>

        <div class="mt-3 flex items-center justify-between gap-2">
          <Show
            when={props.optimization && props.optimization.savingsEur > 0}
            fallback={
              <span class="text-[11px] text-slate-400">
                Aucune sortie/ré-entrée rentable pour ce temps max.
              </span>
            }
          >
            <div class="text-[11px] tabular-nums text-emerald-200/90">
              <strong>{props.optimization!.splitPlazaIds.length}</strong> sortie
              {props.optimization!.splitPlazaIds.length > 1 ? "s" : ""} (~+
              {props.optimization!.addedMinutes} min ·{" "}
              <strong>{formatEur(props.optimization!.savingsPerHourEur)}/h</strong>)
            </div>
            <button
              type="button"
              disabled={isOptimizationApplied()}
              onClick={() => props.onApplyOptimization()}
              class={`inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-[background-color,transform] duration-150 ${
                isOptimizationApplied()
                  ? "cursor-default border border-emerald-500/40 bg-emerald-950/60 text-emerald-300"
                  : "bg-emerald-500 text-slate-950 hover:bg-emerald-400 active:scale-[0.97]"
              }`}
            >
              <Show when={isOptimizationApplied()}>
                <Check class="h-3.5 w-3.5" />
              </Show>
              {isOptimizationApplied() ? "Active" : "Appliquer"}
            </button>
          </Show>
        </div>

        <Show when={props.hasManualBypasses && !isOptimizationApplied()}>
          <p class="mt-2 text-[10px] text-slate-400">
            Vos contournements par nationale et entrées/sorties personnalisées sont conservés.
          </p>
        </Show>
      </section>

      <Show
        when={props.closedRuns.length > 0 && props.dataset}
        fallback={
          <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-center text-xs text-slate-400">
            Aucun réseau fermé avec sorties intermédiaires sur ce trajet.
          </div>
        }
      >
        <div class="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-900/70 p-1">
          <button
            type="button"
            onClick={() => setOnlyProfitableSplits(true)}
            class={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
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
            class={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
              !onlyProfitableSplits()
                ? "bg-slate-800 text-slate-100"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Toutes les sorties
          </button>
        </div>

        <div class="space-y-2">
          <For each={props.closedRuns}>
            {(run) => {
              const allInsights = () =>
                props.dataset
                  ? evaluateIntermediateSplitCandidates({
                      dataset: props.dataset,
                      run,
                      vehicleClass: props.vehicleClass,
                      splitPlazaIds: props.splitPlazaIds,
                      override: props.runOverrides[run.id],
                      splitExtraMinutes: props.splitExtraMinutes,
                    })
                  : [];
              const profitableCount = () =>
                allInsights().filter((item) => item.savingsEur !== null && item.savingsEur > 0)
                  .length;
              const activeCount = () => allInsights().filter((item) => item.isActive).length;
              const visibleInsights = () =>
                onlyProfitableSplits()
                  ? allInsights().filter(
                      (item) => item.isActive || (item.savingsEur !== null && item.savingsEur > 0),
                    )
                  : allInsights();
              const isCollapsed = () => collapsedRunIds().has(run.id);

              return (
                <Show when={allInsights().length > 0}>
                  <div class="overflow-hidden rounded-xl border border-slate-800/90 bg-slate-900/60">
                    <button
                      type="button"
                      onClick={() => toggleRunCollapsed(run.id)}
                      class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-800/50"
                    >
                      <div class="min-w-0">
                        <div class="truncate text-xs font-semibold text-slate-100">
                          {run.concessionaire} ({run.highways.join(" / ")})
                        </div>
                        <div class="text-[10px] tabular-nums text-slate-400">
                          <span class="font-semibold text-emerald-300">
                            {profitableCount()} rentable{profitableCount() > 1 ? "s" : ""}
                          </span>{" "}
                          sur {allInsights().length}
                          {activeCount() > 0
                            ? ` · ${activeCount()} active${activeCount() > 1 ? "s" : ""}`
                            : ""}
                        </div>
                      </div>
                      <Show
                        when={isCollapsed()}
                        fallback={<ChevronUp class="h-4 w-4 shrink-0 text-slate-400" />}
                      >
                        <ChevronDown class="h-4 w-4 shrink-0 text-slate-400" />
                      </Show>
                    </button>

                    <Show when={!isCollapsed()}>
                      <div class="border-t border-slate-800/80 p-2">
                        <Show
                          when={visibleInsights().length > 0}
                          fallback={
                            <div class="px-2 py-2.5 text-center text-[11px] text-slate-400">
                              Aucune sortie/ré-entrée rentable sur cette portion.
                            </div>
                          }
                        >
                          <div class="space-y-1">
                            <For each={visibleInsights()}>
                              {(insight) => {
                                const isProfitable = () =>
                                  insight.savingsEur !== null && insight.savingsEur > 0;
                                const isLoss = () =>
                                  insight.savingsEur !== null && insight.savingsEur < 0;
                                return (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      props.onToggleSplitPlaza(insight.matched.plaza.id)
                                    }
                                    class={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] ${
                                      insight.isActive
                                        ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-100"
                                        : isProfitable()
                                          ? "border-emerald-500/25 bg-emerald-950/20 text-slate-200 hover:border-emerald-400/50 hover:bg-emerald-950/35"
                                          : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                                    }`}
                                  >
                                    <div class="min-w-0">
                                      <div class="truncate font-semibold">
                                        {insight.matched.plaza.name}
                                      </div>
                                      <div class="text-[10px] tabular-nums text-slate-400">
                                        {insight.matched.plaza.highway}
                                        {insight.matched.plaza.exitNumber
                                          ? ` · n°${insight.matched.plaza.exitNumber}`
                                          : ""}
                                        {insight.savingsPerHourEur
                                          ? ` · ${formatEur(insight.savingsPerHourEur)}/h`
                                          : ""}
                                      </div>
                                    </div>

                                    <div class="flex shrink-0 items-center gap-1.5 tabular-nums">
                                      <Show when={insight.savingsEur !== null}>
                                        <span
                                          class={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                                            isProfitable()
                                              ? "bg-emerald-500/20 text-emerald-300"
                                              : isLoss()
                                                ? "bg-rose-500/15 text-rose-300"
                                                : "bg-slate-800 text-slate-400"
                                          }`}
                                        >
                                          {isProfitable()
                                            ? `-${formatEur(insight.savingsEur!)}`
                                            : isLoss()
                                              ? `+${formatEur(Math.abs(insight.savingsEur!))}`
                                              : "0,00 €"}
                                        </span>
                                      </Show>
                                      <span
                                        class={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                                          insight.isActive
                                            ? "bg-emerald-400 text-slate-950"
                                            : "bg-slate-800 text-slate-300"
                                        }`}
                                      >
                                        <Scissors class="h-2.5 w-2.5" />
                                        {insight.isActive
                                          ? "Actif"
                                          : `+${props.splitExtraMinutes}m`}
                                      </span>
                                    </div>
                                  </button>
                                );
                              }}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </Show>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};
