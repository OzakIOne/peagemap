import { Moon, Sun } from "lucide-solid";
import type * as maplibregl from "maplibre-gl";
import maplibreWorkerCode from "maplibre-gl/dist/maplibre-gl-worker.mjs?raw";
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { resolveRunEntryExitIndices } from "~/domain/toll-calculator";
import type {
  BypassDetour,
  MatchedTollUnit,
  PlaceSuggestion,
  PricedTollSection,
  RouteGeometry,
  RunEntryExitOverride,
} from "~/domain/toll-types";
import { formatEur } from "~/lib/format";

interface LineFeature {
  type: "Feature";
  properties: Record<string, string | number | boolean>;
  geometry: {
    type: "LineString";
    coordinates: Array<[number, number]>;
  };
}

interface LineFeatureCollection {
  type: "FeatureCollection";
  features: LineFeature[];
}

const DARK_STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const LIGHT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

interface TollMapProps {
  origin: PlaceSuggestion | null;
  destination: PlaceSuggestion | null;
  stops: PlaceSuggestion[];
  highwayRoute: RouteGeometry | null;
  tollFreeRoute: RouteGeometry | null;
  showTollFree: boolean;
  units: MatchedTollUnit[];
  sections: PricedTollSection[];
  runOverrides: Readonly<Record<string, RunEntryExitOverride>>;
  onSetRunEntry: (runId: string, plazaId: string | undefined) => void;
  onSetRunExit: (runId: string, plazaId: string | undefined) => void;
  bypassDetours: Readonly<Record<string, BypassDetour>>;
  loadingBypassIds: ReadonlySet<string>;
  splitPlazaIds: ReadonlySet<string>;
  selectedSectionId: string | null;
  onToggleSplitPlaza: (plazaId: string) => void;
  onSelectSection: (sectionId: string) => void;
}

const emptyFeatureCollection = (): LineFeatureCollection => ({
  type: "FeatureCollection",
  features: [],
});

const lineFeature = (
  coordinates: Array<[number, number]>,
  properties: Record<string, string | number | boolean>,
): LineFeature => ({
  type: "Feature",
  properties,
  geometry: {
    type: "LineString",
    coordinates,
  },
});

export const TollMap = (props: TollMapProps) => {
  let containerRef: HTMLDivElement | undefined;
  let mapInstance: maplibregl.Map | null = null;
  let maplibreModule: typeof maplibregl | null = null;
  let activeMarkers: maplibregl.Marker[] = [];
  let activePopup: maplibregl.Popup | null = null;
  let lastFittedKey = "";

  const [mapReady, setMapReady] = createSignal(false);
  const [darkStyle, setDarkStyle] = createSignal(true);

  const clearMarkers = () => {
    activePopup?.remove();
    activePopup = null;
    for (const marker of activeMarkers) {
      marker.remove();
    }
    activeMarkers = [];
  };

  const ensureRouteLayers = (map: maplibregl.Map) => {
    if (!map.getSource("toll-free-route")) {
      map.addSource("toll-free-route", {
        type: "geojson",
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: "toll-free-route-line",
        type: "line",
        source: "toll-free-route",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#a78bfa",
          "line-width": 4,
          "line-dasharray": [2, 2],
          "line-opacity": 0.8,
        },
      });
    }

    if (!map.getSource("base-highway-route")) {
      map.addSource("base-highway-route", {
        type: "geojson",
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: "base-highway-route-casing",
        type: "line",
        source: "base-highway-route",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#0f172a",
          "line-width": 9,
          "line-opacity": 0.75,
        },
      });
      map.addLayer({
        id: "base-highway-route-line",
        type: "line",
        source: "base-highway-route",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#475569",
          "line-width": 5,
          "line-opacity": 0.9,
        },
      });
    }

    if (!map.getSource("toll-sections")) {
      map.addSource("toll-sections", {
        type: "geojson",
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: "toll-sections-glow",
        type: "line",
        source: "toll-sections",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": [
            "case",
            ["get", "isBypassed"],
            "#f59e0b",
            ["get", "isSplit"],
            "#10b981",
            "#38bdf8",
          ],
          "line-width": ["case", ["get", "isSelected"], 13, 10],
          "line-opacity": ["case", ["get", "isSelected"], 0.35, 0.2],
          "line-blur": 4,
        },
      });
      map.addLayer({
        id: "toll-sections-line",
        type: "line",
        source: "toll-sections",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": [
            "case",
            ["get", "isBypassed"],
            "#94a3b8",
            ["get", "isSplit"],
            "#10b981",
            "#38bdf8",
          ],
          "line-width": ["case", ["get", "isBypassed"], 3.5, ["get", "isSelected"], 7, 5.5],
          "line-opacity": ["case", ["get", "isBypassed"], 0.38, 1],
        },
      });
    }

    if (!map.getSource("bypass-detours")) {
      map.addSource("bypass-detours", {
        type: "geojson",
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: "bypass-detours-glow",
        type: "line",
        source: "bypass-detours",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#f59e0b",
          "line-width": ["case", ["get", "isSelected"], 13, 10],
          "line-opacity": ["case", ["get", "isSelected"], 0.4, 0.22],
          "line-blur": 4,
        },
      });
      map.addLayer({
        id: "bypass-detours-line",
        type: "line",
        source: "bypass-detours",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#f59e0b",
          "line-width": ["case", ["get", "isSelected"], 7, 5.5],
          "line-opacity": 0.98,
        },
      });
    }
  };

  const syncMapData = () => {
    const map = mapInstance;
    const ml = maplibreModule;
    if (!map || !ml || !mapReady()) return;

    ensureRouteLayers(map);

    const tollFreeSource = map.getSource("toll-free-route") as maplibregl.GeoJSONSource | undefined;
    if (tollFreeSource) {
      if (props.showTollFree && props.tollFreeRoute && props.tollFreeRoute.coordinates.length > 1) {
        void tollFreeSource.setData({
          type: "FeatureCollection",
          features: [lineFeature(props.tollFreeRoute.coordinates, {})],
        });
      } else {
        void tollFreeSource.setData(emptyFeatureCollection());
      }
    }

    const baseSource = map.getSource("base-highway-route") as maplibregl.GeoJSONSource | undefined;
    if (baseSource) {
      if (props.highwayRoute && props.highwayRoute.coordinates.length > 1) {
        void baseSource.setData({
          type: "FeatureCollection",
          features: [lineFeature(props.highwayRoute.coordinates, {})],
        });
      } else {
        void baseSource.setData(emptyFeatureCollection());
      }
    }

    const sectionSource = map.getSource("toll-sections") as maplibregl.GeoJSONSource | undefined;
    if (sectionSource) {
      const features = props.sections
        .filter((section) => section.coordinates.length > 1)
        .map((section) =>
          lineFeature(section.coordinates, {
            id: section.id,
            isBypassed: section.isBypassed,
            isSplit: section.isSplitStart || section.isSplitEnd,
            isSelected: props.selectedSectionId === section.id,
          }),
        );
      void sectionSource.setData({
        type: "FeatureCollection",
        features,
      });
    }

    const detourSource = map.getSource("bypass-detours") as maplibregl.GeoJSONSource | undefined;
    if (detourSource) {
      const detourFeatures = props.sections
        .filter((section) => section.isBypassed)
        .map((section) => {
          const detour = props.bypassDetours[section.id];
          const coords =
            detour && detour.coordinates.length > 1 ? detour.coordinates : section.coordinates;
          if (coords.length < 2) return null;
          return lineFeature(coords, {
            id: section.id,
            isSelected: props.selectedSectionId === section.id,
          });
        })
        .filter((feature): feature is LineFeature => feature !== null);

      void detourSource.setData({
        type: "FeatureCollection",
        features: detourFeatures,
      });
    }

    clearMarkers();

    if (props.origin) {
      const el = document.createElement("div");
      el.className =
        "flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-sky-500 text-xs font-bold text-white shadow-lg";
      el.textContent = "A";
      activeMarkers.push(
        new ml.Marker({ element: el }).setLngLat([props.origin.lon, props.origin.lat]).addTo(map),
      );
    }

    for (let index = 0; index < props.stops.length; index += 1) {
      const stop = props.stops[index];
      if (!stop) continue;
      const el = document.createElement("div");
      el.className =
        "flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-indigo-500 text-[11px] font-bold text-white shadow-lg";
      el.textContent = String(index + 1);
      el.title = `Étape ${index + 1} : ${stop.label}`;
      activeMarkers.push(new ml.Marker({ element: el }).setLngLat([stop.lon, stop.lat]).addTo(map));
    }

    if (props.destination) {
      const el = document.createElement("div");
      el.className =
        "flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-rose-500 text-xs font-bold text-white shadow-lg";
      el.textContent = "B";
      activeMarkers.push(
        new ml.Marker({ element: el })
          .setLngLat([props.destination.lon, props.destination.lat])
          .addTo(map),
      );
    }

    for (const section of props.sections) {
      const detour = section.isBypassed ? props.bypassDetours[section.id] : undefined;
      const isLoadingDetour = section.isBypassed && props.loadingBypassIds.has(section.id);
      const pillCoords =
        detour && detour.coordinates.length > 1 ? detour.coordinates : section.coordinates;
      const midIdx = Math.floor(pillCoords.length / 2);
      const midCoord = pillCoords[midIdx];
      if (!midCoord) continue;

      const pill = document.createElement("button");
      pill.type = "button";
      const isSelected = props.selectedSectionId === section.id;
      const isSplit = section.isSplitStart || section.isSplitEnd;
      const toneClass = section.isBypassed
        ? "border-amber-400/80 bg-amber-950/95 text-amber-200"
        : isSplit
          ? "border-emerald-400/80 bg-emerald-950/95 text-emerald-200"
          : "border-sky-400/70 bg-slate-950/95 text-sky-100";
      const ringClass = isSelected ? "ring-2 ring-white scale-110" : "hover:scale-105";
      pill.className = `cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-tight shadow-xl backdrop-blur-md transition-transform ${toneClass} ${ringClass}`;
      pill.textContent = section.isBypassed
        ? isLoadingDetour
          ? "0,00 € · calcul…"
          : `0,00 € · +${detour?.extraMinutes ?? section.bypassExtraMinutes} min`
        : section.basePriceEur !== null
          ? formatEur(section.effectivePriceEur)
          : "Tarif N/C";
      pill.title = `${section.fromPlaza.plaza.name} → ${section.toPlaza.plaza.name} (${section.concessionaire})`;
      pill.addEventListener("click", (event) => {
        event.stopPropagation();
        props.onSelectSection(section.id);
      });

      activeMarkers.push(
        new ml.Marker({ element: pill, anchor: "center" }).setLngLat(midCoord).addTo(map),
      );
    }

    for (const unit of props.units) {
      if (unit.kind === "open") continue;
      const { entryIdx, exitIdx } = resolveRunEntryExitIndices({
        run: unit,
        override: props.runOverrides[unit.id],
      });

      for (let i = 0; i < unit.plazas.length; i += 1) {
        const matched = unit.plazas[i];
        if (!matched) continue;
        const isEntry = i === entryIdx;
        const isExit = i === exitIdx;
        const isOutside = i < entryIdx || i > exitIdx;
        const isInside = i > entryIdx && i < exitIdx;
        const isSplit = isInside && props.splitPlazaIds.has(matched.plaza.id);

        const dot = document.createElement("button");
        dot.type = "button";
        if (isEntry || isExit) {
          dot.className =
            "h-4 w-4 cursor-pointer rounded-full border-2 border-white bg-sky-500 shadow-lg transition-transform hover:scale-125";
          dot.title = `${isEntry ? "Entrée autoroute" : "Sortie autoroute"} : ${matched.plaza.name} (${matched.plaza.highway})`;
        } else if (isSplit) {
          dot.className =
            "flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-[10px] font-bold text-white shadow-lg transition-transform hover:scale-125";
          dot.textContent = "✂";
          dot.title = `${matched.plaza.name} (${matched.plaza.highway}) — Fractionnement actif`;
        } else if (isOutside) {
          dot.className =
            "h-2.5 w-2.5 cursor-pointer rounded-full border border-amber-300/70 bg-amber-950/90 opacity-80 shadow transition-transform hover:scale-150 hover:bg-sky-400";
          dot.title = `${matched.plaza.name} (${matched.plaza.highway}) — Hors péage (cliquer pour choisir)`;
        } else {
          dot.className =
            "h-3 w-3 cursor-pointer rounded-full border border-slate-200/80 bg-slate-900/90 shadow-md transition-transform hover:scale-150 hover:bg-sky-400";
          dot.title = `${matched.plaza.name} (${matched.plaza.highway}) — Cliquer pour entrer, sortir ou fractionner`;
        }

        dot.addEventListener("click", (event) => {
          event.stopPropagation();
          activePopup?.remove();

          const popupEl = document.createElement("div");
          popupEl.className = "min-w-[205px] space-y-2 text-xs";

          const header = document.createElement("div");
          header.innerHTML = `<div class="font-semibold text-slate-100">${matched.plaza.name}</div><div class="text-[10px] text-slate-400">${matched.plaza.highway} · ${matched.plaza.concessionaire}${matched.plaza.exitNumber ? ` · Sortie n°${matched.plaza.exitNumber}` : ""}</div>`;
          popupEl.append(header);

          const actions = document.createElement("div");
          actions.className = "flex flex-col gap-1";

          const addActionBtn = (label: string, tone: string, onClick: () => void) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left text-[11px] font-semibold transition-colors ${tone}`;
            btn.textContent = label;
            btn.addEventListener("click", (btnEvent) => {
              btnEvent.stopPropagation();
              activePopup?.remove();
              activePopup = null;
              onClick();
            });
            actions.append(btn);
          };

          if (i < unit.plazas.length - 1 && !isEntry) {
            addActionBtn(
              i === 0 ? "Entrer dès le début" : "Entrer sur l’autoroute ici",
              "bg-sky-500/20 text-sky-200 hover:bg-sky-500/35",
              () => props.onSetRunEntry(unit.id, matched.plaza.id),
            );
          }

          if (i > 0 && !isExit) {
            addActionBtn(
              i === unit.plazas.length - 1 ? "Sortir jusqu’à la fin" : "Sortir de l’autoroute ici",
              "bg-amber-500/20 text-amber-200 hover:bg-amber-500/35",
              () => props.onSetRunExit(unit.id, matched.plaza.id),
            );
          }

          if (isInside) {
            addActionBtn(
              isSplit ? "Annuler le fractionnement (✂)" : "Fractionner ici (+4 min)",
              "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/35",
              () => props.onToggleSplitPlaza(matched.plaza.id),
            );
          }

          popupEl.append(actions);

          activePopup = new ml.Popup({
            closeButton: true,
            closeOnClick: true,
            offset: 12,
          })
            .setLngLat([matched.plaza.lon, matched.plaza.lat])
            .setDOMContent(popupEl)
            .addTo(map);
        });

        activeMarkers.push(
          new ml.Marker({ element: dot, anchor: "center" })
            .setLngLat([matched.plaza.lon, matched.plaza.lat])
            .addTo(map),
        );
      }
    }

    const stopsKey = props.stops.map((stop) => `${stop.lon},${stop.lat}`).join(";");
    const fitKey = `${props.origin?.lon ?? ""},${props.origin?.lat ?? ""}|${stopsKey}|${props.destination?.lon ?? ""},${props.destination?.lat ?? ""}|${props.highwayRoute?.distanceMeters ?? 0}`;
    if (
      props.highwayRoute &&
      props.highwayRoute.coordinates.length > 1 &&
      fitKey !== lastFittedKey
    ) {
      lastFittedKey = fitKey;
      const bounds = new ml.LngLatBounds();
      for (const coord of props.highwayRoute.coordinates) {
        bounds.extend(coord);
      }
      map.fitBounds(bounds, {
        padding: { top: 72, bottom: 72, left: 440, right: 72 },
        maxZoom: 12,
        duration: 650,
      });
    }
  };

  onMount(() => {
    let disposed = false;
    let workerBlobUrl: string | null = null;

    onCleanup(() => {
      disposed = true;
      clearMarkers();
      mapInstance?.remove();
      mapInstance = null;
      if (workerBlobUrl) {
        URL.revokeObjectURL(workerBlobUrl);
        workerBlobUrl = null;
      }
    });

    void (async () => {
      if (!containerRef) return;
      const ml = await import("maplibre-gl");
      if (disposed || !containerRef) return;

      workerBlobUrl = URL.createObjectURL(
        new Blob([maplibreWorkerCode], { type: "text/javascript" }),
      );
      ml.setWorkerUrl(workerBlobUrl);
      maplibreModule = ml;

      const map = new ml.Map({
        container: containerRef,
        style: DARK_STYLE_URL,
        center: [2.4, 46.7],
        zoom: 5.5,
        attributionControl: false,
      });

      map.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new ml.AttributionControl({ compact: true }), "bottom-right");

      map.on("load", () => {
        if (disposed) return;
        setMapReady(true);
        syncMapData();
      });

      mapInstance = map;
    })();
  });

  createEffect(() => {
    if (!mapReady()) return;
    syncMapData();
  });

  const toggleMapStyle = () => {
    const map = mapInstance;
    if (!map) return;
    const nextDark = !darkStyle();
    setDarkStyle(nextDark);
    setMapReady(false);
    map.setStyle(nextDark ? DARK_STYLE_URL : LIGHT_STYLE_URL);
    map.once("style.load", () => {
      setMapReady(true);
      syncMapData();
    });
  };

  return (
    <div class="relative h-full w-full">
      <div
        ref={(el) => {
          containerRef = el;
        }}
        class="h-full w-full"
      />

      <div class="pointer-events-none absolute right-4 top-4 z-10 flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={toggleMapStyle}
          class="pointer-events-auto flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-950/90 px-3 py-2 text-xs font-medium text-slate-200 shadow-lg backdrop-blur-md transition-colors hover:border-slate-500 hover:bg-slate-900"
        >
          <Show when={darkStyle()} fallback={<Moon class="h-3.5 w-3.5 text-sky-400" />}>
            <Sun class="h-3.5 w-3.5 text-amber-300" />
          </Show>
          {darkStyle() ? "Carte claire" : "Carte sombre"}
        </button>

        <div class="pointer-events-auto rounded-xl border border-slate-800/90 bg-slate-950/88 px-3 py-2 text-[11px] text-slate-300 shadow-lg backdrop-blur-md">
          <div class="flex items-center gap-2">
            <span class="h-2 w-4 rounded-full bg-sky-400" />
            <span>Section péage standard</span>
          </div>
          <div class="mt-1 flex items-center gap-2">
            <span class="h-2 w-4 rounded-full bg-emerald-400" />
            <span>Section fractionnée (✂)</span>
          </div>
          <div class="mt-1 flex items-center gap-2">
            <span class="h-2 w-4 rounded-full bg-amber-400" />
            <span>Section évitée (0 €)</span>
          </div>
          <Show when={props.showTollFree}>
            <div class="mt-1 flex items-center gap-2">
              <span class="h-0.5 w-4 border-t-2 border-dashed border-violet-400" />
              <span>Itinéraire sans péage</span>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};
