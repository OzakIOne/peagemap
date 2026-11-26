import { Moon, Sun } from "lucide-solid";
import type * as maplibregl from "maplibre-gl";
import maplibreWorkerCode from "maplibre-gl/dist/maplibre-gl-worker.mjs?raw";
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type {
  MatchedTollUnit,
  PlaceSuggestion,
  PricedTollSection,
  RouteGeometry,
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
  highwayRoute: RouteGeometry | null;
  tollFreeRoute: RouteGeometry | null;
  showTollFree: boolean;
  units: MatchedTollUnit[];
  sections: PricedTollSection[];
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
  let lastFittedKey = "";

  const [mapReady, setMapReady] = createSignal(false);
  const [darkStyle, setDarkStyle] = createSignal(true);

  const clearMarkers = () => {
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
            "#f59e0b",
            ["get", "isSplit"],
            "#10b981",
            "#38bdf8",
          ],
          "line-width": ["case", ["get", "isSelected"], 7, 5.5],
          "line-opacity": ["case", ["get", "isBypassed"], 0.85, 1],
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
      const midIdx = Math.floor(section.coordinates.length / 2);
      const midCoord = section.coordinates[midIdx];
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
        ? "0,00 € · évité"
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
      for (let i = 0; i < unit.plazas.length; i += 1) {
        const matched = unit.plazas[i];
        if (!matched) continue;
        const isEndpoint = i === 0 || i === unit.plazas.length - 1;
        const isSplit = props.splitPlazaIds.has(matched.plaza.id);

        const dot = document.createElement("button");
        dot.type = "button";
        if (isEndpoint) {
          dot.className = "h-3.5 w-3.5 rounded-full border-2 border-white bg-sky-500 shadow-md";
          dot.title = `${i === 0 ? "Entrée" : "Sortie"} : ${matched.plaza.name} (${matched.plaza.highway})`;
        } else {
          dot.className = isSplit
            ? "flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-[10px] font-bold text-white shadow-lg transition-transform hover:scale-125"
            : "h-3 w-3 cursor-pointer rounded-full border border-slate-200/80 bg-slate-900/90 shadow-md transition-transform hover:scale-150 hover:bg-emerald-400";
          dot.textContent = isSplit ? "✂" : "";
          dot.title = isSplit
            ? `${matched.plaza.name} (${matched.plaza.highway}) — Fractionnement actif (cliquer pour annuler)`
            : `${matched.plaza.name} (${matched.plaza.highway}) — Cliquer pour sortir & rerentrer (+4 min)`;
          dot.addEventListener("click", (event) => {
            event.stopPropagation();
            props.onToggleSplitPlaza(matched.plaza.id);
          });
        }

        activeMarkers.push(
          new ml.Marker({ element: dot, anchor: "center" })
            .setLngLat([matched.plaza.lon, matched.plaza.lat])
            .addTo(map),
        );
      }
    }

    const fitKey = `${props.origin?.lon ?? ""},${props.origin?.lat ?? ""}|${props.destination?.lon ?? ""},${props.destination?.lat ?? ""}|${props.highwayRoute?.distanceMeters ?? 0}`;
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
