import {
  AlertTriangle,
  Check,
  ClipboardList,
  Download,
  ExternalLink,
  Link2,
  Navigation,
} from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import {
  buildAppleMapsUrl,
  buildCopilotChecklistText,
  buildGoogleMapsUrl,
  buildWazeUrl,
  collectOrderedExportWaypoints,
  downloadGpxFile,
  getExportWarnings,
  type RouteExportInput,
} from "~/lib/route-export";

interface RouteExportBarProps {
  exportInput: RouteExportInput | null;
  onCopyShareLink: () => Promise<boolean>;
}

export const RouteExportBar = (props: RouteExportBarProps) => {
  const [copiedLink, setCopiedLink] = createSignal(false);
  const [copiedChecklist, setCopiedChecklist] = createSignal(false);

  const warnings = () => (props.exportInput ? getExportWarnings(props.exportInput) : []);

  const waypointCounts = () => {
    const input = props.exportInput;
    if (!input) return { split: 0, bypass: 0, stop: 0 };
    const wps = collectOrderedExportWaypoints(input);
    return {
      split: wps.filter((w) => w.kind === "split").length,
      bypass: wps.filter((w) => w.kind === "bypass").length,
      stop: wps.filter((w) => w.kind === "stop").length,
    };
  };

  const handleCopyLink = async () => {
    const ok = await props.onCopyShareLink();
    if (!ok) return;
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyChecklist = async () => {
    const input = props.exportInput;
    if (!input || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(buildCopilotChecklistText(input));
      setCopiedChecklist(true);
      setTimeout(() => setCopiedChecklist(false), 2000);
    } catch {
      // Clipboard blocked in non-secure context
    }
  };

  return (
    <Show when={props.exportInput}>
      {(input) => (
        <div class="safe-bottom shrink-0 border-t border-slate-800/90 bg-slate-950/95 px-4 pt-3 backdrop-blur-xl">
          <Show when={warnings().length > 0}>
            <div class="mb-2 space-y-1">
              <For each={warnings()}>
                {(warning) => (
                  <div class="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-950/35 px-2.5 py-1.5 text-[10px] leading-snug text-amber-200">
                    <AlertTriangle class="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                    <span>{warning}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <div class="mb-2 flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
              <Navigation class="h-3.5 w-3.5 text-sky-400" />
              <span>Exporter</span>
              <Show when={waypointCounts().split > 0 || waypointCounts().bypass > 0}>
                <span class="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-emerald-300">
                  {[
                    waypointCounts().split > 0 ? `${waypointCounts().split} ✂` : null,
                    waypointCounts().bypass > 0 ? `${waypointCounts().bypass} détour` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Show>
            </div>

            <div class="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void handleCopyChecklist()}
                title="Copier le mémo copilote (pratique pour Waze)"
                class="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-1 text-[10px] font-medium text-slate-300 transition-[background-color,border-color,transform] duration-150 hover:border-slate-600 hover:text-white active:scale-[0.97]"
              >
                <Show
                  when={copiedChecklist()}
                  fallback={<ClipboardList class="h-3 w-3 text-slate-400" />}
                >
                  <Check class="h-3 w-3 text-emerald-400" />
                </Show>
                <span>{copiedChecklist() ? "Copié" : "Mémo"}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleCopyLink()}
                title="Copier le lien partageable du trajet"
                class="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-1 text-[10px] font-medium text-slate-300 transition-[background-color,border-color,transform] duration-150 hover:border-sky-500/60 hover:text-sky-200 active:scale-[0.97]"
              >
                <Show when={copiedLink()} fallback={<Link2 class="h-3 w-3 text-sky-400" />}>
                  <Check class="h-3 w-3 text-emerald-400" />
                </Show>
                <span>{copiedLink() ? "Lien copié" : "Lien"}</span>
              </button>
            </div>
          </div>

          <div class="grid grid-cols-4 gap-1.5">
            <a
              href={buildGoogleMapsUrl(input())}
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-2 text-[11px] font-semibold text-slate-100 transition-[border-color,background-color,transform] duration-150 hover:border-sky-500/60 hover:bg-sky-950/35 active:scale-[0.97]"
            >
              <span class="truncate">Maps</span>
              <ExternalLink class="h-3 w-3 shrink-0 text-sky-400" />
            </a>

            <a
              href={buildAppleMapsUrl(input())}
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-2 text-[11px] font-semibold text-slate-100 transition-[border-color,background-color,transform] duration-150 hover:border-slate-500 hover:bg-slate-800/80 active:scale-[0.97]"
            >
              <span class="truncate">Plans</span>
              <ExternalLink class="h-3 w-3 shrink-0 text-slate-400" />
            </a>

            <a
              href={buildWazeUrl(input())}
              target="_blank"
              rel="noopener noreferrer"
              title="Waze n’accepte que la destination via lien — utilisez le bouton Mémo pour vos sorties"
              class="flex items-center justify-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-2 text-[11px] font-semibold text-slate-100 transition-[border-color,background-color,transform] duration-150 hover:border-cyan-500/60 hover:bg-cyan-950/35 active:scale-[0.97]"
            >
              <span class="truncate">Waze</span>
              <ExternalLink class="h-3 w-3 shrink-0 text-cyan-400" />
            </a>

            <button
              type="button"
              onClick={() => downloadGpxFile(input())}
              class="flex items-center justify-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-2 text-[11px] font-semibold text-slate-100 transition-[border-color,background-color,transform] duration-150 hover:border-emerald-500/60 hover:bg-emerald-950/35 active:scale-[0.97]"
            >
              <span>GPX</span>
              <Download class="h-3 w-3 shrink-0 text-emerald-400" />
            </button>
          </div>
        </div>
      )}
    </Show>
  );
};
