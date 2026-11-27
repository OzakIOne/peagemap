import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-solid";
import { For, Show, createEffect } from "solid-js";
import { computeSectionHourlyRateEur, resolveRunEntryExitIndices } from "~/domain/toll-calculator";
import type {
  BypassDetourState,
  ClosedTollRun,
  PricedTollSection,
  RunEntryExitOverride,
} from "~/domain/toll-types";
import { formatEur, formatKm } from "~/lib/format";

interface TollSectionsTabProps {
  closedRuns: ClosedTollRun[];
  sections: PricedTollSection[];
  runOverrides: Readonly<Record<string, RunEntryExitOverride>>;
  bypassStates: Readonly<Record<string, BypassDetourState>>;
  selectedSectionId: string | null;
  hoveredSectionId: string | null;
  scrollToSelectedToken: number;
  onSetRunEntry: (runId: string, plazaId: string | undefined) => void;
  onSetRunExit: (runId: string, plazaId: string | undefined) => void;
  onResetRunOverride: (runId: string) => void;
  onToggleBypassSection: (sectionId: string) => void;
  onRetryBypassSection: (sectionId: string) => void;
  onSelectSection: (sectionId: string) => void;
  onHoverSection: (sectionId: string | null) => void;
}

export const TollSectionsTab = (props: TollSectionsTabProps) => {
  const sectionCardRefs = new Map<string, HTMLDivElement>();

  createEffect(() => {
    const token = props.scrollToSelectedToken;
    const selectedId = props.selectedSectionId;
    if (!token || !selectedId) return;
    const el = sectionCardRefs.get(selectedId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  return (
    <div class="space-y-3 pb-4">
      <Show when={props.closedRuns.length > 0}>
        <div class="space-y-2">
          <For each={props.closedRuns}>
            {(run) => {
              const indices = () =>
                resolveRunEntryExitIndices({
                  run,
                  override: props.runOverrides[run.id],
                });
              const hasOverride = () =>
                indices().entryIdx > 0 || indices().exitIdx < run.plazas.length - 1;
              const entryOptions = () => run.plazas.slice(0, indices().exitIdx);
              const exitOptions = () => run.plazas.slice(indices().entryIdx + 1);
              const totalPlazas = () => Math.max(1, run.plazas.length - 1);
              const leftPct = () => (indices().entryIdx / totalPlazas()) * 100;
              const widthPct = () =>
                Math.max(4, ((indices().exitIdx - indices().entryIdx) / totalPlazas()) * 100);

              return (
                <div class="space-y-2 rounded-xl border border-slate-800/90 bg-slate-900/75 p-2.5">
                  <div class="flex items-center justify-between gap-2">
                    <div class="truncate text-[11px] font-semibold text-slate-200">
                      Portion autoroute · {run.concessionaire} ({run.highways.join(" / ")})
                    </div>
                    <Show when={hasOverride()}>
                      <button
                        type="button"
                        onClick={() => props.onResetRunOverride(run.id)}
                        class="shrink-0 text-[10px] font-semibold text-sky-400 transition-colors hover:text-sky-300"
                      >
                        Tout reprendre
                      </button>
                    </Show>
                  </div>

                  <div
                    class="relative h-1.5 w-full overflow-hidden rounded-full bg-amber-500/35"
                    title="Portion sur autoroute"
                  >
                    <div
                      class="absolute top-0 h-full rounded-full bg-sky-400 transition-[left,width] duration-200 ease-out"
                      style={{
                        left: `${leftPct()}%`,
                        width: `${widthPct()}%`,
                      }}
                    />
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <label class="space-y-1">
                      <span class="block text-[10px] font-medium text-slate-400">Entrer à</span>
                      <select
                        aria-label={`Entrer sur ${run.concessionaire}`}
                        value={run.plazas[indices().entryIdx]?.plaza.id ?? ""}
                        onChange={(event) => {
                          const selectedId = event.currentTarget.value;
                          const firstId = run.plazas[0]?.plaza.id;
                          props.onSetRunEntry(
                            run.id,
                            selectedId === firstId ? undefined : selectedId,
                          );
                        }}
                        class="w-full rounded-lg border border-slate-700/90 bg-slate-950 px-2 py-1.5 text-[11px] font-medium text-slate-100 focus:border-sky-500"
                      >
                        <For each={entryOptions()}>
                          {(item, idx) => (
                            <option value={item.plaza.id}>
                              {item.plaza.name}
                              {idx() === 0 ? " (début)" : ` (${item.plaza.highway})`}
                            </option>
                          )}
                        </For>
                      </select>
                    </label>

                    <label class="space-y-1">
                      <span class="block text-[10px] font-medium text-slate-400">Sortir à</span>
                      <select
                        aria-label={`Sortir de ${run.concessionaire}`}
                        value={run.plazas[indices().exitIdx]?.plaza.id ?? ""}
                        onChange={(event) => {
                          const selectedId = event.currentTarget.value;
                          const lastId = run.plazas[run.plazas.length - 1]?.plaza.id;
                          props.onSetRunExit(
                            run.id,
                            selectedId === lastId ? undefined : selectedId,
                          );
                        }}
                        class="w-full rounded-lg border border-slate-700/90 bg-slate-950 px-2 py-1.5 text-[11px] font-medium text-slate-100 focus:border-sky-500"
                      >
                        <For each={exitOptions()}>
                          {(item) => {
                            const isLast =
                              item.plaza.id === run.plazas[run.plazas.length - 1]?.plaza.id;
                            return (
                              <option value={item.plaza.id}>
                                {item.plaza.name}
                                {isLast ? " (fin)" : ` (${item.plaza.highway})`}
                              </option>
                            );
                          }}
                        </For>
                      </select>
                    </label>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      <Show
        when={props.sections.length > 0}
        fallback={
          <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-center text-xs text-slate-400">
            Aucun péage payant détecté sur cet itinéraire.
          </div>
        }
      >
        <div class="space-y-2">
          <For each={props.sections}>
            {(section) => {
              const isSelected = () => props.selectedSectionId === section.id;
              const isHovered = () => props.hoveredSectionId === section.id;
              const isSplit = () => section.isSplitStart || section.isSplitEnd;
              const bypassState = () => props.bypassStates[section.id];
              const detour = () => {
                const st = bypassState();
                return st?.status === "ready" ? st.detour : undefined;
              };
              const isLoadingDetour = () =>
                section.isBypassed && bypassState()?.status === "loading";
              const detourError = () => {
                const st = bypassState();
                return section.isBypassed && st?.status === "error" ? st.message : null;
              };
              const savedMinutes = () => detour()?.extraMinutes ?? section.bypassExtraMinutes;
              const hourlyRate = () =>
                computeSectionHourlyRateEur({
                  priceEur: section.basePriceEur,
                  savedMinutes: savedMinutes(),
                });

              return (
                <div
                  ref={(el) => {
                    sectionCardRefs.set(section.id, el);
                  }}
                  onMouseEnter={() => props.onHoverSection(section.id)}
                  onMouseLeave={() => props.onHoverSection(null)}
                  class={`rounded-xl border p-3 transition-[border-color,background-color] duration-150 ${
                    isSelected()
                      ? "border-sky-400/80 bg-sky-950/35"
                      : isHovered()
                        ? "border-slate-600 bg-slate-900/95"
                        : section.isBypassed
                          ? "border-amber-500/40 bg-amber-950/20"
                          : isSplit()
                            ? "border-emerald-500/40 bg-emerald-950/20"
                            : "border-slate-800/90 bg-slate-900/65 hover:border-slate-700"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => props.onSelectSection(section.id)}
                    class="flex w-full items-start justify-between gap-2 rounded-lg text-left"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-200">
                          {section.highway}
                        </span>
                        <span class="text-[10px] font-medium text-slate-400">
                          {section.concessionaire}
                        </span>
                        <Show when={section.kind === "open"}>
                          <span class="rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-300">
                            Barrière fixe
                          </span>
                        </Show>
                        <Show when={isSplit()}>
                          <span class="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                            Sortie/ré-entrée
                          </span>
                        </Show>
                        <Show when={section.isBypassed}>
                          <span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                            {section.bypassRole === "before-entry"
                              ? "Avant entrée"
                              : section.bypassRole === "after-exit"
                                ? "Après sortie"
                                : "Évité par nationale"}
                          </span>
                        </Show>
                        <Show when={section.isFreeFlow && !section.isBypassed}>
                          <span class="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
                            Flux libre · 72h
                          </span>
                        </Show>
                      </div>

                      <div class="mt-1 text-xs font-semibold text-slate-100">
                        {section.kind === "open"
                          ? `Péage ${section.fromPlaza.plaza.name}`
                          : `${section.fromPlaza.plaza.name} → ${section.toPlaza.plaza.name}`}
                      </div>

                      <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-slate-400">
                        <Show when={section.distanceKm > 0}>
                          <span>{formatKm(section.distanceKm)}</span>
                        </Show>
                        <Show when={section.basePriceEur !== null && section.distanceKm > 0}>
                          <span>
                            · {(section.basePriceEur! / section.distanceKm).toFixed(2)} €/km
                          </span>
                        </Show>
                        <Show when={hourlyRate()}>
                          {(rate) => (
                            <span
                              class={`rounded px-1.5 py-0.25 text-[10px] font-semibold ${
                                rate() >= 25
                                  ? "bg-amber-500/15 text-amber-300"
                                  : "bg-slate-800/80 text-slate-300"
                              }`}
                              title="Coût par heure gagnée en restant sur l’autoroute plutôt que de prendre la nationale"
                            >
                              Coût : {detour() ? "" : "~"}
                              {formatEur(rate())}/h gagnée
                            </span>
                          )}
                        </Show>
                      </div>
                    </div>

                    <div class="shrink-0 text-right tabular-nums">
                      <div
                        class={`text-sm font-bold ${
                          section.isBypassed
                            ? "text-amber-300"
                            : isSplit()
                              ? "text-emerald-300"
                              : "text-sky-300"
                        }`}
                      >
                        {section.isBypassed
                          ? "0,00 €"
                          : section.basePriceEur !== null
                            ? formatEur(section.effectivePriceEur)
                            : "N/C"}
                      </div>
                      <Show when={section.isBypassed && section.basePriceEur !== null}>
                        <div class="text-[10px] text-slate-500 line-through">
                          {formatEur(section.basePriceEur!)}
                        </div>
                      </Show>
                    </div>
                  </button>

                  <Show
                    when={section.isFreeFlow && !section.isBypassed && section.freeFlowPaymentUrl}
                  >
                    <div class="mt-2 flex items-center justify-between gap-2 rounded-lg border border-violet-500/25 bg-violet-950/25 px-2.5 py-1.5 text-[10px] text-violet-200">
                      <span>Péage sans barrière : paiement sous 72 h (sauf badge télépéage).</span>
                      <a
                        href={section.freeFlowPaymentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex shrink-0 items-center gap-1 font-semibold text-violet-300 underline hover:text-violet-100"
                      >
                        Payer
                        <ExternalLink class="h-2.5 w-2.5" />
                      </a>
                    </div>
                  </Show>

                  <div class="mt-2 flex items-center justify-between gap-2 border-t border-slate-800/70 pt-2">
                    <Show
                      when={section.isBypassed}
                      fallback={
                        <span class="text-[11px] tabular-nums text-slate-400">
                          Gain autoroute : ~{section.bypassExtraMinutes} min
                        </span>
                      }
                    >
                      <Show
                        when={!isLoadingDetour()}
                        fallback={
                          <span class="flex items-center gap-1.5 text-[11px] text-amber-300">
                            <Loader2 class="h-3 w-3 animate-spin" />
                            Calcul du détour…
                          </span>
                        }
                      >
                        <Show
                          when={!detourError()}
                          fallback={
                            <div class="flex items-center gap-1.5 text-[11px] text-rose-300">
                              <AlertTriangle class="h-3 w-3 shrink-0" />
                              <span>Détour indisponible (~+{section.bypassExtraMinutes} min)</span>
                              <button
                                type="button"
                                onClick={() => props.onRetryBypassSection(section.id)}
                                class="inline-flex items-center gap-0.5 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200 hover:bg-rose-500/30"
                              >
                                <RefreshCw class="h-2.5 w-2.5" />
                                Réessayer
                              </button>
                            </div>
                          }
                        >
                          <span class="text-[11px] tabular-nums text-amber-200/90">
                            <Show
                              when={detour()}
                              fallback={`Détour estimé : ~+${section.bypassExtraMinutes} min`}
                            >
                              {(d) => (
                                <>
                                  Détour réel : +{d().extraMinutes} min ·{" "}
                                  {d().extraDistanceKm >= 0 ? "+" : ""}
                                  {d().extraDistanceKm} km
                                </>
                              )}
                            </Show>
                          </span>
                        </Show>
                      </Show>
                    </Show>

                    <button
                      type="button"
                      onClick={() => props.onToggleBypassSection(section.id)}
                      class={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] ${
                        section.isBypassed
                          ? "border border-amber-400/50 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                          : "border border-slate-700 bg-slate-800/90 text-slate-200 hover:border-amber-400/60 hover:bg-amber-950/40 hover:text-amber-200"
                      }`}
                    >
                      {section.isBypassed ? "Reprendre l’autoroute" : "Éviter par nationale"}
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};
