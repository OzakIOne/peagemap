import { LocateFixed, Moon, Sun } from "lucide-solid";
import type * as maplibregl from "maplibre-gl";
import maplibreWorkerCode from "maplibre-gl/dist/maplibre-gl-worker.mjs?raw";
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import {
  SPLIT_EXTRA_MINUTES,
  evaluateIntermediateSplitCandidates,
  isFreeFlowPlaza,
  resolveRunEntryExitIndices,
} from "~/domain/toll-calculator";
import type {
  BypassDetourState,
  MatchedTollUnit,
  PlaceSuggestion,
  PricedTollSection,
  RouteGeometry,
  RunEntryExitOverride,
  TollDataset,
  VehicleClass,
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

export interface TollMapProps {
  dataset: TollDataset | null;
  vehicleClass: VehicleClass;
  splitExtraMinutes: number;
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
  bypassStates: Readonly<Record<string, BypassDetourState>>;
  splitPlazaIds: ReadonlySet<string>;
  selectedSectionId: string | null;
  hoveredSectionId: string | null;
  focusSectionToken: number;
  onToggleSplitPlaza: (plazaId: string) => void;
  onToggleBypassSection: (sectionId: string) => void;
  onSelectSection: (sectionId: string, fromMap?: boolean) => void;
  onHoverSection: (sectionId: string | null) => void;
  onMapPickPoint?: (
    role: "origin" | "stop" | "destination",
    point: { lat: number; lon: number },
  ) => void;
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

const wrapMarkerNode = (child: HTMLElement, zIndex: number): HTMLDivElement => {
  const wrapper = document.createElement("div");
  wrapper.style.zIndex = String(zIndex);
  wrapper.style.display = "flex";
  wrapper.style.alignItems = "center";
  wrapper.style.justifyContent = "center";
  wrapper.append(child);
  return wrapper;
};

const getRoutePalette = (isDark: boolean) =>
  isDark
    ? {
        casing: "#0f172a",
        baseHighway: "#475569",
        standard: "#38bdf8",
        split: "#10b981",
        bypassedHighway: "#94a3b8",
        detour: "#f59e0b",
        tollFree: "#a78bfa",
      }
    : {
        casing: "#ffffff",
        baseHighway: "#64748b",
        standard: "#0284c7",
        split: "#059669",
        bypassedHighway: "#64748b",
        detour: "#d97706",
        tollFree: "#7c3aed",
      };

export const TollMap = (props: TollMapProps) => {
  let containerRef: HTMLDivElement | undefined;
  let mapInstance: maplibregl.Map | null = null;
  let maplibreModule: typeof maplibregl | null = null;
  let activeMarkers: maplibregl.Marker[] = [];
  let sectionPillElements = new Map<string, HTMLButtonElement>();
  let zoomLabelElements: Array<{ el: HTMLElement; compactText: string; fullText: string }> = [];
  let activePopup: maplibregl.Popup | null = null;
  let lastFittedKey = "";
  let styleVersion = 0;
  let disposed = false;

  const [mapReady, setMapReady] = createSignal(false);
  const [darkStyle, setDarkStyle] = createSignal(true);

  const clearMarkers = () => {
    activePopup?.remove();
    activePopup = null;
    for (const marker of activeMarkers) {
      marker.remove();
    }
    activeMarkers = [];
    sectionPillElements = new Map();
    zoomLabelElements = [];
  };

  const updateZoomLabels = (zoom: number) => {
    const showFull = zoom >= 7.2;
    for (const entry of zoomLabelElements) {
      entry.el.textContent = showFull ? entry.fullText : entry.compactText;
    }
  };

  const fitRouteBounds = (includeTollFree: boolean) => {
    const map = mapInstance;
    const ml = maplibreModule;
    if (!map || !ml) return;
    const coords = props.highwayRoute?.coordinates;
    if (!coords || coords.length < 2) return;

    const bounds = new ml.LngLatBounds();
    for (const coord of coords) {
      bounds.extend(coord);
    }
    if (includeTollFree && props.tollFreeRoute) {
      for (const coord of props.tollFreeRoute.coordinates) {
        bounds.extend(coord);
      }
    }
    for (const section of props.sections) {
      if (!section.isBypassed) continue;
      const state = props.bypassStates[section.id];
      if (state?.status === "ready") {
        for (const coord of state.detour.coordinates) {
          bounds.extend(coord);
        }
      }
    }

    const isMobile = typeof window !== "undefined" && window.innerWidth < 1024;
    map.fitBounds(bounds, {
      padding: isMobile
        ? { top: 64, bottom: 220, left: 32, right: 32 }
        : { top: 64, bottom: 64, left: 64, right: 64 },
      maxZoom: 12,
      duration: 550,
    });
  };

  const ensureRouteLayers = (map: maplibregl.Map, isDark: boolean) => {
    const palette = getRoutePalette(isDark);

    if (!map.getSource("toll-free-route")) {
      map.addSource("toll-free-route", {
        type: "geojson",
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: "toll-free-route-casing",
        type: "line",
        source: "toll-free-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": palette.casing,
          "line-width": 7,
          "line-opacity": 0.75,
        },
      });
      map.addLayer({
        id: "toll-free-route-line",
        type: "line",
        source: "toll-free-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": palette.tollFree,
          "line-width": 4,
          "line-dasharray": [2, 2],
          "line-opacity": 0.9,
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
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": palette.casing,
          "line-width": 9,
          "line-opacity": 0.8,
        },
      });
      map.addLayer({
        id: "base-highway-route-line",
        type: "line",
        source: "base-highway-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": palette.baseHighway,
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
        id: "toll-sections-casing",
        type: "line",
        source: "toll-sections",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": palette.casing,
          "line-width": ["case", ["get", "isHighlighted"], 11, 8.5],
          "line-opacity": ["case", ["get", "isBypassed"], 0.3, 0.85],
        },
      });
      map.addLayer({
        id: "toll-sections-line",
        type: "line",
        source: "toll-sections",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "case",
            ["get", "isBypassed"],
            palette.bypassedHighway,
            ["get", "isSplit"],
            palette.split,
            palette.standard,
          ],
          "line-width": ["case", ["get", "isBypassed"], 3.5, ["get", "isHighlighted"], 7.5, 5.5],
          "line-opacity": ["case", ["get", "isBypassed"], 0.4, 1],
        },
      });
      map.addLayer({
        id: "toll-sections-hit",
        type: "line",
        source: "toll-sections",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#000000",
          "line-width": 18,
          "line-opacity": 0,
        },
      });
    }

    if (!map.getSource("bypass-detours")) {
      map.addSource("bypass-detours", {
        type: "geojson",
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: "bypass-detours-casing",
        type: "line",
        source: "bypass-detours",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": palette.casing,
          "line-width": ["case", ["get", "isHighlighted"], 11, 8.5],
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "bypass-detours-line",
        type: "line",
        source: "bypass-detours",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": palette.detour,
          "line-width": ["case", ["get", "isHighlighted"], 7.5, 5.5],
          "line-opacity": 0.98,
        },
      });
      map.addLayer({
        id: "bypass-detours-hit",
        type: "line",
        source: "bypass-detours",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#000000",
          "line-width": 18,
          "line-opacity": 0,
        },
      });
    }
  };

  const attachLayerInteractions = (map: maplibregl.Map) => {
    const clickableLayers = ["toll-sections-hit", "bypass-detours-hit"] as const;
    for (const layerId of clickableLayers) {
      map.on("click", layerId, (event) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.id;
        if (typeof id === "string") {
          props.onSelectSection(id, true);
        }
      });
      map.on("mouseenter", layerId, (event) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = event.features?.[0];
        const id = feature?.properties?.id;
        if (typeof id === "string") {
          props.onHoverSection(id);
        }
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
        props.onHoverSection(null);
      });
    }
  };

  onMount(() => {
    let workerBlobUrl: string | null = null;
    let resizeObserver: ResizeObserver | null = null;

    onCleanup(() => {
      disposed = true;
      resizeObserver?.disconnect();
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
      map.addControl(new ml.ScaleControl({ unit: "metric" }), "bottom-left");
      map.addControl(new ml.AttributionControl({ compact: true }), "bottom-right");

      map.on("zoom", () => {
        updateZoomLabels(map.getZoom());
      });

      map.on("contextmenu", (event) => {
        if (!props.onMapPickPoint) return;
        event.preventDefault();
        activePopup?.remove();

        const popupEl = document.createElement("div");
        popupEl.className = "min-w-[185px] space-y-1.5 text-xs";

        const title = document.createElement("div");
        title.className = "font-semibold text-slate-100";
        title.textContent = "Point sur la carte";
        popupEl.append(title);

        const coordsEl = document.createElement("div");
        coordsEl.className = "text-[10px] tabular-nums text-slate-400";
        coordsEl.textContent = `${event.lngLat.lat.toFixed(4)}, ${event.lngLat.lng.toFixed(4)}`;
        popupEl.append(coordsEl);

        const actions = document.createElement("div");
        actions.className = "flex flex-col gap-1 pt-1";

        const addPickBtn = (
          label: string,
          tone: string,
          role: "origin" | "stop" | "destination",
        ) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left text-[11px] font-semibold transition-colors ${tone}`;
          btn.textContent = label;
          btn.addEventListener("click", (btnEvent) => {
            btnEvent.stopPropagation();
            activePopup?.remove();
            activePopup = null;
            props.onMapPickPoint?.(role, { lat: event.lngLat.lat, lon: event.lngLat.lng });
          });
          actions.append(btn);
        };

        addPickBtn(
          "Définir comme départ (A)",
          "bg-sky-500/20 text-sky-200 hover:bg-sky-500/35",
          "origin",
        );
        addPickBtn(
          "Ajouter comme étape",
          "bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/35",
          "stop",
        );
        addPickBtn(
          "Définir comme arrivée (B)",
          "bg-rose-500/20 text-rose-200 hover:bg-rose-500/35",
          "destination",
        );

        popupEl.append(actions);

        activePopup = new ml.Popup({ closeButton: true, closeOnClick: true, offset: 8 })
          .setLngLat(event.lngLat)
          .setDOMContent(popupEl)
          .addTo(map);
      });

      map.on("load", () => {
        if (disposed) return;
        ensureRouteLayers(map, darkStyle());
        attachLayerInteractions(map);
        setMapReady(true);
      });

      resizeObserver = new ResizeObserver(() => {
        if (!disposed) {
          map.resize();
        }
      });
      resizeObserver.observe(containerRef);

      mapInstance = map;
    })();
  });

  // Effect 1: Sync GeoJSON route & section lines
  createEffect(() => {
    if (!mapReady()) return;
    const map = mapInstance;
    if (!map) return;

    ensureRouteLayers(map, darkStyle());

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
            isHighlighted:
              props.selectedSectionId === section.id || props.hoveredSectionId === section.id,
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
          const state = props.bypassStates[section.id];
          const coords =
            state?.status === "ready" && state.detour.coordinates.length > 1
              ? state.detour.coordinates
              : section.coordinates;
          if (coords.length < 2) return null;
          return lineFeature(coords, {
            id: section.id,
            isHighlighted:
              props.selectedSectionId === section.id || props.hoveredSectionId === section.id,
          });
        })
        .filter((feature): feature is LineFeature => feature !== null);

      void detourSource.setData({
        type: "FeatureCollection",
        features: detourFeatures,
      });
    }
  });

  // Effect 2: Sync DOM markers (independent of selectedSectionId/hoveredSectionId)
  createEffect(() => {
    if (!mapReady()) return;
    const map = mapInstance;
    const ml = maplibreModule;
    if (!map || !ml) return;

    clearMarkers();

    if (props.origin) {
      const pin = document.createElement("div");
      pin.className =
        "flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-sky-500 text-xs font-bold text-white shadow-lg";
      pin.textContent = "A";
      activeMarkers.push(
        new ml.Marker({ element: wrapMarkerNode(pin, 30) })
          .setLngLat([props.origin.lon, props.origin.lat])
          .addTo(map),
      );
    }

    for (let index = 0; index < props.stops.length; index += 1) {
      const stop = props.stops[index];
      if (!stop) continue;
      const pin = document.createElement("div");
      pin.className =
        "flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-indigo-500 text-[11px] font-bold text-white shadow-lg";
      pin.textContent = String(index + 1);
      pin.title = `Étape ${index + 1} : ${stop.label}`;
      activeMarkers.push(
        new ml.Marker({ element: wrapMarkerNode(pin, 28) })
          .setLngLat([stop.lon, stop.lat])
          .addTo(map),
      );
    }

    if (props.destination) {
      const pin = document.createElement("div");
      pin.className =
        "flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-rose-500 text-xs font-bold text-white shadow-lg";
      pin.textContent = "B";
      activeMarkers.push(
        new ml.Marker({ element: wrapMarkerNode(pin, 30) })
          .setLngLat([props.destination.lon, props.destination.lat])
          .addTo(map),
      );
    }

    for (const section of props.sections) {
      const state = section.isBypassed ? props.bypassStates[section.id] : undefined;
      const isLoadingDetour = section.isBypassed && state?.status === "loading";
      const detourCoords = state?.status === "ready" ? state.detour.coordinates : undefined;
      const pillCoords =
        detourCoords && detourCoords.length > 1 ? detourCoords : section.coordinates;
      const midCoord = pillCoords[Math.floor(pillCoords.length / 2)];
      if (!midCoord) continue;

      const pill = document.createElement("button");
      pill.type = "button";
      const isSplit = section.isSplitStart || section.isSplitEnd;
      const toneClass = section.isBypassed
        ? "border-amber-400/80 bg-amber-950/95 text-amber-200"
        : isSplit
          ? "border-emerald-400/80 bg-emerald-950/95 text-emerald-200"
          : "border-sky-400/70 bg-slate-950/95 text-sky-100";
      pill.dataset.baseClass = `cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums tracking-tight shadow-xl backdrop-blur-md transition-transform duration-150 ease-out active:scale-95 ${toneClass}`;
      pill.className = `${pill.dataset.baseClass} hover:scale-105`;
      pill.textContent = section.isBypassed
        ? isLoadingDetour
          ? "Détour…"
          : state?.status === "ready"
            ? `0 € · +${state.detour.extraMinutes}m`
            : "0 € · évité"
        : section.basePriceEur !== null
          ? formatEur(section.effectivePriceEur)
          : "N/C";
      pill.title = `${section.fromPlaza.plaza.name} → ${section.toPlaza.plaza.name} (${section.highway})`;
      pill.addEventListener("click", (event) => {
        event.stopPropagation();
        props.onSelectSection(section.id, true);
      });
      pill.addEventListener("mouseenter", () => props.onHoverSection(section.id));
      pill.addEventListener("mouseleave", () => props.onHoverSection(null));

      sectionPillElements.set(section.id, pill);

      activeMarkers.push(
        new ml.Marker({ element: wrapMarkerNode(pill, 20), anchor: "center" })
          .setLngLat(midCoord)
          .addTo(map),
      );
    }

    const currentZoom = map.getZoom();
    const dataset = props.dataset;

    for (const unit of props.units) {
      if (unit.kind === "open") {
        const matched = unit.plaza;
        const sectionId = `sec:${unit.id}`;
        const section = props.sections.find((s) => s.id === sectionId);
        const isBypassed = Boolean(section?.isBypassed);

        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = isBypassed
          ? "h-3.5 w-3.5 cursor-pointer rounded-full border-2 border-amber-300 bg-amber-950 shadow-md transition-transform duration-150 hover:scale-125"
          : "h-4 w-4 cursor-pointer rounded-full border-2 border-white bg-sky-500 shadow-lg transition-transform duration-150 hover:scale-125";
        dot.title = `Barrière fixe : ${matched.plaza.name} (${matched.plaza.highway})`;

        dot.addEventListener("click", (event) => {
          event.stopPropagation();
          activePopup?.remove();

          const popupEl = document.createElement("div");
          popupEl.className = "min-w-[205px] space-y-2 text-xs";

          const titleEl = document.createElement("div");
          titleEl.className = "font-semibold text-slate-100";
          titleEl.textContent = matched.plaza.name;
          const subEl = document.createElement("div");
          subEl.className = "text-[10px] text-slate-400";
          subEl.textContent = `${matched.plaza.highway} · ${matched.plaza.concessionaire} · Barrière fixe`;
          popupEl.append(titleEl, subEl);

          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = isBypassed
            ? "w-full cursor-pointer rounded-lg bg-sky-500/20 px-2.5 py-1.5 text-left text-[11px] font-semibold text-sky-200 transition-colors hover:bg-sky-500/35"
            : "w-full cursor-pointer rounded-lg bg-amber-500/20 px-2.5 py-1.5 text-left text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/35";
          btn.textContent = isBypassed ? "Reprendre l’autoroute" : "Éviter par nationale";
          btn.addEventListener("click", (btnEvent) => {
            btnEvent.stopPropagation();
            activePopup?.remove();
            activePopup = null;
            props.onToggleBypassSection(sectionId);
          });
          popupEl.append(btn);

          activePopup = new ml.Popup({ closeButton: true, closeOnClick: true, offset: 12 })
            .setLngLat([matched.plaza.lon, matched.plaza.lat])
            .setDOMContent(popupEl)
            .addTo(map);
        });

        activeMarkers.push(
          new ml.Marker({ element: wrapMarkerNode(dot, 18), anchor: "center" })
            .setLngLat([matched.plaza.lon, matched.plaza.lat])
            .addTo(map),
        );
        continue;
      }

      const { entryIdx, exitIdx } = resolveRunEntryExitIndices({
        run: unit,
        override: props.runOverrides[unit.id],
      });

      const splitSavingsByPlazaId = new Map<string, number | null>();
      if (dataset) {
        const insights = evaluateIntermediateSplitCandidates({
          dataset,
          run: unit,
          vehicleClass: props.vehicleClass,
          splitPlazaIds: props.splitPlazaIds,
          override: props.runOverrides[unit.id],
          splitExtraMinutes: props.splitExtraMinutes,
        });
        for (const insight of insights) {
          splitSavingsByPlazaId.set(insight.matched.plaza.id, insight.savingsEur);
        }
      }

      for (let i = 0; i < unit.plazas.length; i += 1) {
        const matched = unit.plazas[i];
        if (!matched) continue;
        const isEntry = i === entryIdx;
        const isExit = i === exitIdx;
        const isOutside = i < entryIdx || i > exitIdx;
        const isInside = i > entryIdx && i < exitIdx;
        const isSplit = isInside && props.splitPlazaIds.has(matched.plaza.id);
        const isCustomEntry = isEntry && entryIdx > 0;
        const isCustomExit = isExit && exitIdx < unit.plazas.length - 1;
        const freeFlow = isFreeFlowPlaza(matched.plaza);

        const dot = document.createElement("button");
        dot.type = "button";
        let zIndex = 12;

        if (isCustomEntry || isCustomExit) {
          zIndex = 25;
          dot.className =
            "cursor-pointer whitespace-nowrap rounded-full border-2 border-white bg-sky-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-xl transition-transform duration-150 hover:scale-105 active:scale-95";
          const fullText = `${isCustomEntry ? "Entrée" : "Sortie"} · ${matched.plaza.name}`;
          const compactText = isCustomEntry ? "Entrée" : "Sortie";
          dot.textContent = currentZoom >= 7.2 ? fullText : compactText;
          dot.title = `${isCustomEntry ? "Entrée autoroute choisie" : "Sortie autoroute choisie"} : ${matched.plaza.name} (${matched.plaza.highway})`;
          zoomLabelElements.push({ el: dot, compactText, fullText });
        } else if (isEntry || isExit) {
          zIndex = 22;
          dot.className =
            "h-4 w-4 cursor-pointer rounded-full border-2 border-white bg-sky-500 shadow-lg transition-transform duration-150 hover:scale-125";
          dot.title = `${isEntry ? "Entrée autoroute" : "Sortie autoroute"} : ${matched.plaza.name} (${matched.plaza.highway})`;
        } else if (isSplit) {
          zIndex = 25;
          dot.className =
            "flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border-2 border-white bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-slate-950 shadow-xl transition-transform duration-150 hover:scale-105 active:scale-95";
          const fullText = `✂ ${matched.plaza.name}`;
          const compactText = "✂";
          dot.textContent = currentZoom >= 7.2 ? fullText : compactText;
          dot.title = `${matched.plaza.name} (${matched.plaza.highway}) — Sortie/ré-entrée active (cliquer pour modifier)`;
          zoomLabelElements.push({ el: dot, compactText, fullText });
        } else if (isOutside) {
          zIndex = 10;
          dot.className =
            "h-2.5 w-2.5 cursor-pointer rounded-full border border-amber-300/70 bg-amber-950/90 opacity-80 shadow transition-transform duration-150 hover:scale-150 hover:bg-sky-400";
          dot.title = `${matched.plaza.name} (${matched.plaza.highway}) — Hors péage (cliquer pour choisir)`;
        } else {
          zIndex = 12;
          dot.className =
            "h-3.5 w-3.5 cursor-pointer rounded-full border-2 border-slate-200/85 bg-slate-900/95 shadow-md transition-transform duration-150 hover:scale-140 hover:border-emerald-300 hover:bg-emerald-500";
          dot.title = `${matched.plaza.name} (${matched.plaza.highway}) — Cliquer pour entrer, sortir ou faire une sortie/ré-entrée`;
        }

        dot.addEventListener("click", (event) => {
          event.stopPropagation();
          activePopup?.remove();

          const popupEl = document.createElement("div");
          popupEl.className = "min-w-[215px] space-y-2 text-xs";

          const header = document.createElement("div");
          const titleEl = document.createElement("div");
          titleEl.className = "font-semibold text-slate-100";
          titleEl.textContent = matched.plaza.name;
          const subEl = document.createElement("div");
          subEl.className = "text-[10px] text-slate-400";
          subEl.textContent = `${matched.plaza.highway} · ${matched.plaza.concessionaire}${matched.plaza.exitNumber ? ` · Sortie n°${matched.plaza.exitNumber}` : ""}${freeFlow ? " · Flux libre" : ""}`;
          header.append(titleEl, subEl);
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

          if (isCustomEntry) {
            addActionBtn(
              "Réinitialiser l’entrée autoroute",
              "bg-slate-800 text-slate-200 hover:bg-slate-700",
              () => props.onSetRunEntry(unit.id, undefined),
            );
          } else if (i < unit.plazas.length - 1 && !isEntry) {
            addActionBtn(
              i === 0 ? "Entrer dès le début" : "Entrer sur l’autoroute ici",
              "bg-sky-500/20 text-sky-200 hover:bg-sky-500/35",
              () => props.onSetRunEntry(unit.id, matched.plaza.id),
            );
          }

          if (isCustomExit) {
            addActionBtn(
              "Réinitialiser la sortie autoroute",
              "bg-slate-800 text-slate-200 hover:bg-slate-700",
              () => props.onSetRunExit(unit.id, undefined),
            );
          } else if (i > 0 && !isExit) {
            addActionBtn(
              i === unit.plazas.length - 1 ? "Sortir jusqu’à la fin" : "Sortir de l’autoroute ici",
              "bg-amber-500/20 text-amber-200 hover:bg-amber-500/35",
              () => props.onSetRunExit(unit.id, matched.plaza.id),
            );
          }

          if (isInside && !freeFlow) {
            const savings = splitSavingsByPlazaId.get(matched.plaza.id);
            const mins = props.splitExtraMinutes || SPLIT_EXTRA_MINUTES;
            const splitLabel = isSplit
              ? "Annuler la sortie/ré-entrée (✂)"
              : savings !== undefined && savings !== null && savings > 0
                ? `Sortie/ré-entrée (-${formatEur(savings)} · +${mins} min)`
                : `Sortie/ré-entrée (+${mins} min)`;
            addActionBtn(
              splitLabel,
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
          new ml.Marker({ element: wrapMarkerNode(dot, zIndex), anchor: "center" })
            .setLngLat([matched.plaza.lon, matched.plaza.lat])
            .addTo(map),
        );
      }
    }
  });

  // Effect 3: Lightweight pill selection/hover ring update without rebuilding markers
  createEffect(() => {
    const selectedId = props.selectedSectionId;
    const hoveredId = props.hoveredSectionId;
    for (const [id, pill] of sectionPillElements.entries()) {
      const base = pill.dataset.baseClass ?? "";
      const isHighlighted = id === selectedId || id === hoveredId;
      pill.className = isHighlighted
        ? `${base} ring-2 ring-white scale-110`
        : `${base} hover:scale-105`;
    }
  });

  // Effect 4: Fit route bounds when route changes
  createEffect(() => {
    if (!mapReady()) return;
    const stopsKey = props.stops.map((stop) => `${stop.lon},${stop.lat}`).join(";");
    const fitKey = `${props.origin?.lon ?? ""},${props.origin?.lat ?? ""}|${stopsKey}|${props.destination?.lon ?? ""},${props.destination?.lat ?? ""}|${props.highwayRoute?.distanceMeters ?? 0}`;
    if (
      props.highwayRoute &&
      props.highwayRoute.coordinates.length > 1 &&
      fitKey !== lastFittedKey
    ) {
      lastFittedKey = fitKey;
      fitRouteBounds(props.showTollFree);
    }
  });

  // Effect 5: Smoothly focus a section when selected from the sidebar
  createEffect(() => {
    if (!mapReady()) return;
    const token = props.focusSectionToken;
    const selectedId = props.selectedSectionId;
    const map = mapInstance;
    const ml = maplibreModule;
    if (!token || !selectedId || !map || !ml) return;

    const section = props.sections.find((s) => s.id === selectedId);
    if (!section) return;
    const state = section.isBypassed ? props.bypassStates[section.id] : undefined;
    const coords =
      state?.status === "ready" && state.detour.coordinates.length > 1
        ? state.detour.coordinates
        : section.coordinates;
    if (coords.length < 2) return;

    const bounds = new ml.LngLatBounds();
    for (const coord of coords) {
      bounds.extend(coord);
    }
    map.fitBounds(bounds, {
      padding: { top: 96, bottom: 96, left: 96, right: 96 },
      maxZoom: 12.5,
      duration: 450,
    });
  });

  const toggleMapStyle = () => {
    const map = mapInstance;
    if (!map) return;
    const nextDark = !darkStyle();
    const requestVersion = ++styleVersion;
    setDarkStyle(nextDark);
    setMapReady(false);
    map.setStyle(nextDark ? DARK_STYLE_URL : LIGHT_STYLE_URL);
    map.once("style.load", () => {
      if (disposed || requestVersion !== styleVersion) return;
      ensureRouteLayers(map, nextDark);
      attachLayerInteractions(map);
      setMapReady(true);
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

      <div class="pointer-events-none absolute right-3 top-3 z-10 flex flex-col items-end gap-2 sm:right-4 sm:top-4">
        <div class="pointer-events-auto flex items-center gap-1.5">
          <Show when={props.highwayRoute}>
            <button
              type="button"
              onClick={() => fitRouteBounds(props.showTollFree)}
              title="Recentrer l’itinéraire"
              class="flex items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-950/90 px-2.5 py-2 text-xs font-medium text-slate-200 shadow-lg backdrop-blur-md transition-[background-color,border-color,transform] duration-150 ease-out hover:border-slate-500 hover:bg-slate-900 active:scale-[0.97]"
            >
              <LocateFixed class="h-3.5 w-3.5 text-sky-400" />
              <span class="hidden sm:inline">Recentrer</span>
            </button>
          </Show>

          <button
            type="button"
            onClick={toggleMapStyle}
            class="flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-950/90 px-3 py-2 text-xs font-medium text-slate-200 shadow-lg backdrop-blur-md transition-[background-color,border-color,transform] duration-150 ease-out hover:border-slate-500 hover:bg-slate-900 active:scale-[0.97]"
          >
            <Show when={darkStyle()} fallback={<Moon class="h-3.5 w-3.5 text-sky-400" />}>
              <Sun class="h-3.5 w-3.5 text-amber-300" />
            </Show>
            <span class="hidden sm:inline">{darkStyle() ? "Carte claire" : "Carte sombre"}</span>
          </button>
        </div>

        <Show when={props.highwayRoute}>
          <div class="pointer-events-auto hidden rounded-xl border border-slate-800/90 bg-slate-950/88 px-3 py-2 text-[11px] text-slate-300 shadow-lg backdrop-blur-md sm:block">
            <div class="flex items-center gap-2">
              <span class="h-2 w-4 rounded-full bg-sky-400" />
              <span>Autoroute directe</span>
            </div>
            <div class="mt-1 flex items-center gap-2">
              <span class="h-2 w-4 rounded-full bg-emerald-400" />
              <span>Sortie/ré-entrée (✂)</span>
            </div>
            <div class="mt-1 flex items-center gap-2">
              <span class="h-2 w-4 rounded-full bg-amber-400" />
              <span>Évité par nationale (0 €)</span>
            </div>
            <Show when={props.showTollFree}>
              <div class="mt-1 flex items-center gap-2">
                <span class="h-0.5 w-4 border-t-2 border-dashed border-violet-400" />
                <span>Sans péage</span>
              </div>
            </Show>
            <div class="mt-1.5 border-t border-slate-800 pt-1 text-[10px] text-slate-400">
              Clic sur un point = entrer/sortir · Clic droit = étape
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
};
