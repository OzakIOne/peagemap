import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { TariffTuple, TollDataset, TollPlaza, TollSource } from "../src/domain/toll-types";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(SCRIPT_DIR, "..");
const RAW_DIR = resolve(ROOT_DIR, "data/raw");
const OUTPUT_PATH = resolve(ROOT_DIR, "public/data/tolls-fr-2026.json");

const TollPlazaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  exitNumber: z.string().optional(),
  highway: z.string().min(1),
  concessionaire: z.string().min(1),
  networkId: z.string().min(1),
  system: z.enum(["closed", "open"]),
  lat: z.number(),
  lon: z.number(),
});

const TariffTupleSchema = z.tuple([z.number(), z.number(), z.number()]);

const TollSourceSchema = z.object({
  concessionaire: z.string(),
  year: z.number(),
  url: z.string(),
  plazaCount: z.number(),
  tariffCount: z.number(),
});

const TollDatasetSchema: z.ZodType<TollDataset> = z.object({
  version: z.string(),
  updatedAt: z.string(),
  sources: z.array(TollSourceSchema),
  plazas: z.array(TollPlazaSchema),
  tariffs: z.record(z.string(), TariffTupleSchema),
});

interface RawSourceSpec {
  filename: string;
  url: string;
  label: string;
  optional?: boolean;
}

const RAW_SOURCES: RawSourceSpec[] = [
  {
    filename: "gares-peage-2025.csv",
    url: "https://static.data.gouv.fr/resources/gares-de-peage-du-reseau-routier-national-concede/20250728-140859/gares-peage-2025.csv",
    label: "MTE Gares de péage (Lambert-93)",
  },
  {
    filename: "portiques-free-flow-2026.csv",
    url: "https://static.data.gouv.fr/resources/autoroutes-et-peages-en-flux-libre/20261107-093049/portiques-free-flow-07-11-2026.csv",
    label: "DGITM Portiques Flux Libre 2026",
  },
  {
    filename: "GLOBAL_toll_info.csv",
    url: "https://raw.githubusercontent.com/louis2038/OpenTollData/main/parse/GLOBAL_toll_info.csv",
    label: "OpenTollData OSM Coordinates",
  },
  {
    filename: "aprr-2026-02.csv",
    url: "https://static.data.gouv.fr/resources/tarifs-autoroutes-aprr/20260802-131933/2026-02.csv",
    label: "APRR Tarifs 2026-02",
  },
  {
    filename: "area-2026-02.csv",
    url: "https://static.data.gouv.fr/resources/tarifs-autoroutes-aprr/20260802-131936/2026-02.csv",
    label: "AREA Tarifs 2026-02",
  },
  {
    filename: "Tarifs_ASF.txt",
    url: "https://public-content.vinci-autoroutes.com/PDF/Tarifs-peage-asf/Tarifs_ASF.txt",
    label: "ASF Tarifs 2026",
  },
  {
    filename: "Tarifs_Cofiroute_Arcour.txt",
    url: "https://public-content.vinci-autoroutes.com/PDF/Tarifs-peage-Cofiroute/Tarifs_Cofiroute_Arcour.txt",
    label: "Cofiroute + Arcour Tarifs 2026",
  },
  {
    filename: "Tarifs_ESCOTA.txt",
    url: "https://public-content.vinci-autoroutes.com/PDF/Tarifs-peage-Escota/Tarifs_ESCOTA.txt",
    label: "ESCOTA Tarifs 2026",
  },
  {
    filename: "joe_20260130_0025_0037.pdf",
    url: "https://www.a63-atlandes.fr/wp-content/uploads/2026/01/joe_20260130_0025_0037.pdf",
    label: "JO 2026 Concessionnaires",
    optional: true,
  },
  {
    filename: "aprr-area-open-2026.pdf",
    url: "https://voyage.aprr.fr/sites/default/files/2026-02/2026-%20Syst%C3%A8mes%20Ouverts%20APRR-AREA.pdf",
    label: "APRR/AREA Systèmes Ouverts 2026",
    optional: true,
  },
  {
    filename: "convoyage-peages-overlay.json",
    url: "https://raw.githubusercontent.com/at374/convoyage-app/main/peages-overlay.json",
    label: "Convoyage-app 2026 Verified Cross-Reference (SANEF/SAPN/ATMB/SFTRF/Open)",
  },
];

const SOURCE_URLS: Record<string, string> = {
  APRR: "https://static.data.gouv.fr/resources/tarifs-autoroutes-aprr/20260802-131933/2026-02.csv",
  AREA: "https://static.data.gouv.fr/resources/tarifs-autoroutes-aprr/20260802-131936/2026-02.csv",
  ASF: "https://public-content.vinci-autoroutes.com/PDF/Tarifs-peage-asf/Tarifs_ASF.txt",
  COFIROUTE:
    "https://public-content.vinci-autoroutes.com/PDF/Tarifs-peage-Cofiroute/Tarifs_Cofiroute_Arcour.txt",
  ESCOTA: "https://public-content.vinci-autoroutes.com/PDF/Tarifs-peage-Escota/Tarifs_ESCOTA.txt",
  SANEF: "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053417647",
  SAPN: "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053417647",
  ATMB: "https://www.a63-atlandes.fr/wp-content/uploads/2026/01/joe_20260130_0025_0037.pdf",
  SFTRF: "https://www.a63-atlandes.fr/wp-content/uploads/2026/01/joe_20260130_0025_0037.pdf",
  ATLANDES: "https://www.a63-atlandes.fr/wp-content/uploads/2026/01/joe_20260130_0025_0037.pdf",
  ALBEA: "https://www.a63-atlandes.fr/wp-content/uploads/2026/01/joe_20260130_0025_0037.pdf",
  ADELAC: "https://www.a63-atlandes.fr/wp-content/uploads/2026/01/joe_20260130_0025_0037.pdf",
  ALIAE: "https://www.a63-atlandes.fr/wp-content/uploads/2026/01/joe_20260130_0025_0037.pdf",
  ALIENOR: "https://www.a63-atlandes.fr/wp-content/uploads/2026/01/joe_20260130_0025_0037.pdf",
  ALIS: "https://www.a63-atlandes.fr/wp-content/uploads/2026/01/joe_20260130_0025_0037.pdf",
  ALICORNE: "https://www.a63-atlandes.fr/wp-content/uploads/2026/01/joe_20260130_0025_0037.pdf",
  ARCOS: "https://www.a63-atlandes.fr/wp-content/uploads/2026/01/joe_20260130_0025_0037.pdf",
  CEVM: "https://www.a63-atlandes.fr/wp-content/uploads/2026/01/joe_20260130_0025_0037.pdf",
  AUTRE:
    "https://static.data.gouv.fr/resources/gares-de-peage-du-reseau-routier-national-concede/20250728-140859/gares-peage-2025.csv",
};

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const GRS80_A = 6378137.0;
const GRS80_INV_F = 298.257222101;
const GRS80_F = 1 / GRS80_INV_F;
const GRS80_E = Math.sqrt(2 * GRS80_F - GRS80_F * GRS80_F);

const L93_LON0 = 3 * DEG_TO_RAD;
const L93_LAT0 = 46.5 * DEG_TO_RAD;
const L93_LAT1 = 44 * DEG_TO_RAD;
const L93_LAT2 = 49 * DEG_TO_RAD;
const L93_X0 = 700000.0;
const L93_Y0 = 6600000.0;

const isometricLat = (latRad: number, e: number): number => {
  const sinLat = Math.sin(latRad);
  return Math.log(
    Math.tan(Math.PI / 4 + latRad / 2) * Math.pow((1 - e * sinLat) / (1 + e * sinLat), e / 2),
  );
};

const grandNormal = (latRad: number, a: number, e: number): number => {
  const sinLat = Math.sin(latRad);
  return a / Math.sqrt(1 - e * e * sinLat * sinLat);
};

const L93_ISO1 = isometricLat(L93_LAT1, GRS80_E);
const L93_ISO2 = isometricLat(L93_LAT2, GRS80_E);
const L93_ISO0 = isometricLat(L93_LAT0, GRS80_E);
const L93_N =
  Math.log(
    (grandNormal(L93_LAT2, GRS80_A, GRS80_E) * Math.cos(L93_LAT2)) /
      (grandNormal(L93_LAT1, GRS80_A, GRS80_E) * Math.cos(L93_LAT1)),
  ) /
  (L93_ISO1 - L93_ISO2);
const L93_C =
  ((grandNormal(L93_LAT1, GRS80_A, GRS80_E) * Math.cos(L93_LAT1)) / L93_N) *
  Math.exp(L93_N * L93_ISO1);
const L93_XS = L93_X0;
const L93_YS = L93_Y0 + L93_C * Math.exp(-L93_N * L93_ISO0);

const lambert93ToWgs84 = (x: number, y: number): { lat: number; lon: number } => {
  const dx = x - L93_XS;
  const dy = L93_YS - y;
  const r = Math.hypot(dx, dy);
  const gamma = Math.atan2(dx, dy);
  const lonRad = L93_LON0 + gamma / L93_N;
  const iso = (-1 / L93_N) * Math.log(r / L93_C);

  let latRad = 2 * Math.atan(Math.exp(iso)) - Math.PI / 2;
  for (let iter = 0; iter < 12; iter += 1) {
    const eSin = GRS80_E * Math.sin(latRad);
    latRad =
      2 * Math.atan(Math.exp(iso) * Math.pow((1 + eSin) / (1 - eSin), GRS80_E / 2)) - Math.PI / 2;
  }

  return {
    lat: latRad * RAD_TO_DEG,
    lon: lonRad * RAD_TO_DEG,
  };
};

const isValidFranceCoord = (lat: number, lon: number): boolean =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  lat >= 41 &&
  lat <= 52 &&
  lon >= -5.5 &&
  lon <= 10;

const roundCoord = (value: number): number => Math.round(value * 100_000) / 100_000;
const roundPrice = (value: number): number => Math.round(value * 100) / 100;
const roundTenth = (value: number): number => Math.round(value * 10) / 10;

const haversineKm = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const dLat = (bLat - aLat) * DEG_TO_RAD;
  const dLon = (bLon - aLon) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat + Math.cos(aLat * DEG_TO_RAD) * Math.cos(bLat * DEG_TO_RAD) * sinLon * sinLon;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};

const downloadAllSources = async (refresh: boolean): Promise<void> => {
  mkdirSync(RAW_DIR, { recursive: true });
  for (const source of RAW_SOURCES) {
    const dest = resolve(RAW_DIR, source.filename);
    if (!refresh && existsSync(dest) && statSync(dest).size > 0) {
      continue;
    }
    console.log(`Downloading ${source.label}...`);
    try {
      const response = await fetch(source.url, {
        headers: { "User-Agent": "PeageMapDataBuilder/1.0" },
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      writeFileSync(dest, buffer);
    } catch (error) {
      if (source.optional) {
        console.warn(`Optional download skipped (${source.filename}):`, String(error));
        continue;
      }
      throw new Error(`Failed to download ${source.filename}: ${String(error)}`, { cause: error });
    }
  }
};

const parseDelimitedLine = (line: string, delimiter: string): string[] => {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
};

const parseCsvRows = (text: string, delimiter: string): Array<Record<string, string>> => {
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = parseDelimitedLine(headerLine, delimiter);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const values = parseDelimitedLine(line, delimiter);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j += 1) {
      const key = headers[j];
      if (key !== undefined) {
        row[key] = values[j] ?? "";
      }
    }
    rows.push(row);
  }
  return rows;
};

const parseFrenchNumber = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const normalized = raw.trim().replace(",", ".");
  if (normalized.length === 0) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
};

const normalizeName = (raw: string): string => {
  let s = raw
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036F]/g, "")
    .toUpperCase()
    .replaceAll(/['’`]/g, " ")
    .replaceAll(/\bS\s*\/\s*/g, "SUR ")
    .replaceAll(/[()[\],.;:/_-]+/g, " ")
    .replaceAll(/\bN[°O]?\s*\d+[A-Z]?\b/g, " ")
    .replaceAll(
      /\b(PEAGE DE|PEAGE D|GARE DE|GARE D|PORTIQUE FLUX LIBRE|PORTIQUE|FLUX LIBRE|BPV|FL|SENS \d|SORTIE|ENTREE|BRETELLE DE|BRETELLE|DIFFUSEUR|ECHANGEUR|BARRIERE DE|BARRIERE)\b/g,
      " ",
    )
    .replaceAll(/\bST\b/g, "SAINT")
    .replaceAll(/\bSTE\b/g, "SAINTE")
    .replaceAll(/\bCH\b/g, "CHATEAU")
    .replaceAll(/\bMT\b/g, "MONT")
    .replaceAll(/\bN\b/g, "NORD")
    .replaceAll(/\bS\b/g, "SUD")
    .replaceAll(/\bE\b/g, "EST")
    .replaceAll(/\bO\b/g, "OUEST")
    .replaceAll(/\s+/g, " ")
    .trim();
  s = s
    .replaceAll(/\b(A\d{1,3}[A-Z]?)\b/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
  return s;
};

const normalizeCompact = (raw: string): string => normalizeName(raw).replaceAll(/\s+/g, "");

const slugify = (raw: string): string =>
  raw
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

const extractHighwayFromMteRoute = (route: string): string => {
  const trimmed = route.trim().toUpperCase();
  const direct = /^A0*(\d+[A-Z]?)$/.exec(trimmed);
  if (direct?.[1]) return `A${direct[1]}`;
  const ramp = /^\d{2}A90*(\d{1,3})\d{2}[A-Z]*$/.exec(trimmed);
  if (ramp?.[1]) return `A${Number.parseInt(ramp[1], 10)}`;
  const generic = /A0*(\d{1,3}[A-Z]?)/.exec(trimmed);
  if (generic?.[1]) return `A${generic[1]}`;
  return "A";
};

const normalizeHighway = (raw: string | undefined): string => {
  if (!raw) return "";
  const upper = raw.trim().toUpperCase().replaceAll(/\s+/g, "");
  const match = /^([AN])0*(\d+[A-Z]?)$/.exec(upper);
  if (match?.[1] && match[2]) return `${match[1]}${match[2]}`;
  return upper;
};

const normalizeConcessionaire = (raw: string | undefined): string => {
  if (!raw) return "";
  const upper = raw
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036F]/g, "")
    .replaceAll(/['’`]/g, "")
    .toUpperCase()
    .trim();
  if (upper.includes("APRR")) return "APRR";
  if (upper.includes("AREA")) return "AREA";
  if (upper.includes("ASF")) return "ASF";
  if (upper.includes("COFIROUTE") || upper.includes("ARCOUR")) return "COFIROUTE";
  if (upper.includes("ESCOTA")) return "ESCOTA";
  if (upper.includes("SANEF")) return "SANEF";
  if (upper.includes("SAPN")) return "SAPN";
  if (upper.includes("ATMB")) return "ATMB";
  if (upper.includes("SFTRF")) return "SFTRF";
  if (upper.includes("ATLANDES")) return "ATLANDES";
  if (upper.includes("ALBEA")) return "ALBEA";
  if (upper.includes("ADELAC")) return "ADELAC";
  if (upper.includes("ALIAE")) return "ALIAE";
  if (upper.includes("ALIENOR")) return "ALIENOR";
  if (upper.includes("ALIS")) return "ALIS";
  if (upper.includes("ALICORNE")) return "ALICORNE";
  if (upper.includes("ARCOS")) return "ARCOS";
  if (upper.includes("CEVM") || upper.includes("MILLAU")) return "CEVM";
  if (upper.includes("ATOSCA")) return "ATOSCA";
  return upper;
};

interface CoordCandidate {
  lat: number;
  lon: number;
  sourcePriority: number;
  displayName: string;
  highway?: string;
  concessionaire?: string;
  exitNumber?: string;
}

const CURATED_NAME_ALIASES: Record<string, string[]> = {
  "PARIS LA FOLIE BESSIN": ["SAINT ARNOULT", "ST ARNOULT"],
  "PARIS ROISSY CHAMANT": ["SENLIS CHAMANT", "CHAMANT", "SENLIS"],
  "LILLE DOURGES": ["FRESNES LES MONTAUBAN", "FRESNES", "DOURGES"],
  "MEAUX CRECY": ["COUTEVROULT", "SAINT JEAN LES DEUX JUMEAUX"],
  "PARIS NOISY LE GRAND": ["COUTEVROULT", "SAINT JEAN LES DEUX JUMEAUX"],
  STRASBOURG: ["SCHWINDRATZHEIM", "HOCHFELDEN"],
  "ANGERS CORZE": ["CORZE"],
  "TOURS CENTRE MONNAIE": ["MONNAIE"],
  "TOURS CENTRE SORIGNY": ["SORIGNY", "MONTS SORIGNY"],
  ANGERS: ["SAINT JEAN DE LINIERES", "ANGERS OUEST"],
  "ANGERS ZONE SORTIES 16 17": ["SAINT JEAN DE LINIERES", "ANGERS OUEST"],
  NANTES: ["CARQUEFOU", "NANTES CARQUEFOU"],
  "NANTES ZONE SORTIES 23 25": ["CARQUEFOU", "NANTES CARQUEFOU"],
  LANCON: ["LANCON DE PROVENCE", "LANCON PROVENCE"],
  "VILLEFRANCHE LIMAS": ["VILLEFRANCHE LIMAS", "VILLEFRANCHE SUR SAONE", "LIMAS"],
  VIENNE: ["VIENNE", "REVENTIN VAUGRIS"],
  "CLERMONT BARRIERE": ["GERZAT", "CLERMONT FERRAND"],
  "CHARMONT LIM CONC": ["CHARMONT SOUS BARBUISE", "CHARMONT"],
  "BOURGES LIM CONC": ["BOURGES"],
  "REIMS EST TAISSY": ["TAISSY", "REIMS EST"],
  "REIMS NORD ORMES": ["ORMES", "REIMS NORD"],
  "REIMS OUEST THILLOIS": ["THILLOIS", "REIMS OUEST"],
  "MONTREUIL REIMS": ["MONTREUIL AUX LIONS"],
  CAEN: ["DOZULE", "TROARN", "CAGNY"],
  "LE HAVRE": ["SAINT ROMAIN DE COLBOSC", "QUETTEVILLE"],
  "BONNIERES SUR SEINE": ["BUCHELAY", "BONNIERES"],
  ORIGINE: ["LA BARQUE", "AIX EN PROVENCE"],
  "AIX EN PROVENCE": ["LA BARQUE", "AIX EN PROVENCE"],
  "LE BOULOU": ["LE BOULOU"],
  ESPAGNE: ["LE PERTHUS", "LE BOULOU"],
  LYON: ["SAINT QUENTIN FALLAVIER", "VILLEFRANCHE LIMAS"],
  ROUEN: ["BOURG ACHARD", "HEUDEBOUVILLE"],
  "AUVOURS LE MANS ZI SUD": ["LE MANS SUD", "AUVOURS"],
  "VILLEFRANCHE SUR CHER": ["ROMORANTIN", "VILLEFRANCHE SUR CHER"],
  "SAINT GERMAIN LES VERGN": ["SAINT GERMAIN LES VERGNES"],
  BOULOGNE: ["HERBINGHEN", "BOULOGNE SUR MER"],
  CALAIS: ["SETTEN", "CALAIS", "SAINT OMER"],
  METZ: ["SAINT AVOLD", "BOULAY", "METZ"],
  "LIMITE POITIERS": ["POITIERS SUD", "POITIERS NORD"],
  "LIMITE LE MANS OUEST": ["LE MANS NORD", "LE MANS OUEST"],
  LIMITE: ["CLERMONT FERRAND"],
  "ST GIBRIEN": ["SAINT GIBRIEN", "CHALONS EN CHAMPAGNE"],
  "CHALONS MOURMELON": ["MOURMELON", "CHALONS"],
  "ST ETIENNE AU TEMPLE": ["SAINT ETIENNE AU TEMPLE"],
  "STE MENEHOULD": ["SAINTE MENEHOULD"],
  "VALLEE DE L AUBE": ["ARCIS SUR AUBE", "VALLEE DE L AUBE"],
  "FRESNES EN WOEVRE": ["FRESNES EN WOEVRE"],
  "BAYONNE MOUSSEROLLES": ["BAYONNE NORD", "BIARRITZ"],
};

const KNOWN_EXACT_COORDS: Record<
  string,
  { lat: number; lon: number; highway: string; concessionaire: string; canonicalName?: string }
> = {
  "PARIS LA FOLIE BESSIN": {
    lat: 48.54645,
    lon: 1.91114,
    highway: "A10",
    concessionaire: "COFIROUTE",
    canonicalName: "Saint-Arnoult (Paris A10/A11)",
  },
  "SAINT ARNOULT": {
    lat: 48.54645,
    lon: 1.91114,
    highway: "A10",
    concessionaire: "COFIROUTE",
    canonicalName: "Saint-Arnoult (Paris A10/A11)",
  },
  "TOURS CENTRE MONNAIE": {
    lat: 47.49263,
    lon: 0.78519,
    highway: "A10",
    concessionaire: "COFIROUTE",
  },
  "TOURS CENTRE SORIGNY": {
    lat: 47.25442,
    lon: 0.67097,
    highway: "A10",
    concessionaire: "COFIROUTE",
  },
  "ANGERS CORZE": { lat: 47.55159, lon: -0.37126, highway: "A11", concessionaire: "COFIROUTE" },
  ANGERS: { lat: 47.46669, lon: -0.65963, highway: "A11", concessionaire: "COFIROUTE" },
  "BEAUPREAU SAINT GERMAIN": {
    lat: 47.4191,
    lon: -0.8622,
    highway: "A11",
    concessionaire: "COFIROUTE",
  },
  VIEILLEVILLE: { lat: 47.3452, lon: -1.4301, highway: "A11", concessionaire: "COFIROUTE" },
  NANTES: {
    lat: 47.30203,
    lon: -1.46482,
    highway: "A11",
    concessionaire: "COFIROUTE",
    canonicalName: "Nantes (Carquefou)",
  },
  ANCENIS: { lat: 47.38637, lon: -1.17958, highway: "A11", concessionaire: "COFIROUTE" },
  VIRSAC: { lat: 45.02581, lon: -0.44075, highway: "A10", concessionaire: "ASF" },
  "PARIS ROISSY CHAMANT": {
    lat: 49.21558,
    lon: 2.62803,
    highway: "A1",
    concessionaire: "SANEF",
    canonicalName: "Chamant (Paris / Roissy)",
  },
  "LILLE DOURGES": {
    lat: 50.33583,
    lon: 2.93112,
    highway: "A1",
    concessionaire: "SANEF",
    canonicalName: "Fresnes-lès-Montauban (Lille / Dourges)",
  },
  "MEAUX CRECY": {
    lat: 48.8765,
    lon: 2.9152,
    highway: "A4",
    concessionaire: "SANEF",
    canonicalName: "Meaux / Crécy (Coutevroult)",
  },
  "PARIS NOISY LE GRAND": {
    lat: 48.86783,
    lon: 2.84539,
    highway: "A4",
    concessionaire: "SANEF",
    canonicalName: "Coutevroult (Paris / Noisy-le-Grand)",
  },
  STRASBOURG: {
    lat: 48.76953,
    lon: 7.60235,
    highway: "A4",
    concessionaire: "SANEF",
    canonicalName: "Schwindratzheim (Strasbourg)",
  },
  HOCHFELDEN: {
    lat: 48.76953,
    lon: 7.60235,
    highway: "A4",
    concessionaire: "SANEF",
    canonicalName: "Schwindratzheim (Strasbourg)",
  },
  SCHWINDRATZHEIM: {
    lat: 48.76953,
    lon: 7.60235,
    highway: "A4",
    concessionaire: "SANEF",
    canonicalName: "Schwindratzheim (Strasbourg)",
  },
  "FLEURY EN BIERE": {
    lat: 48.42868,
    lon: 2.53899,
    highway: "A6",
    concessionaire: "APRR",
    canonicalName: "Fleury-en-Bière",
  },
  "VILLEFRANCHE LIMAS": {
    lat: 45.96311,
    lon: 4.71761,
    highway: "A6",
    concessionaire: "APRR",
    canonicalName: "Villefranche-Limas",
  },
  VIENNE: {
    lat: 45.4758,
    lon: 4.83257,
    highway: "A7",
    concessionaire: "ASF",
    canonicalName: "Vienne",
  },
  LANCON: {
    lat: 43.58821,
    lon: 5.14891,
    highway: "A7",
    concessionaire: "ASF",
    canonicalName: "Lançon-de-Provence",
  },
  BUCHELAY: { lat: 48.9837, lon: 1.68121, highway: "A13", concessionaire: "SAPN" },
  "BONNIERES SUR SEINE": { lat: 48.9837, lon: 1.68121, highway: "A13", concessionaire: "SAPN" },
  HEUDEBOUVILLE: { lat: 49.19509, lon: 1.22996, highway: "A13", concessionaire: "SAPN" },
  BEUZEVILLE: { lat: 49.3381, lon: 0.36787, highway: "A13", concessionaire: "SAPN" },
  DOZULE: { lat: 49.22846, lon: -0.08119, highway: "A13", concessionaire: "SAPN" },
  CAEN: { lat: 49.16834, lon: -0.24499, highway: "A13", concessionaire: "SAPN" },
};

class CoordIndex {
  private readonly byNorm = new Map<string, CoordCandidate[]>();
  private readonly byCompact = new Map<string, CoordCandidate[]>();

  add(rawName: string, candidate: CoordCandidate): void {
    if (!isValidFranceCoord(candidate.lat, candidate.lon)) return;
    const norm = normalizeName(rawName);
    if (norm.length < 2) return;
    const compact = norm.replaceAll(/\s+/g, "");

    const listNorm = this.byNorm.get(norm);
    if (listNorm) {
      listNorm.push(candidate);
    } else {
      this.byNorm.set(norm, [candidate]);
    }

    const listCompact = this.byCompact.get(compact);
    if (listCompact) {
      listCompact.push(candidate);
    } else {
      this.byCompact.set(compact, [candidate]);
    }
  }

  private pickBest(
    candidates: CoordCandidate[] | undefined,
    preferredHighway?: string,
    preferredConcessionaire?: string,
  ): CoordCandidate | null {
    if (!candidates || candidates.length === 0) return null;
    let best: CoordCandidate | null = null;
    let bestScore = -1;
    for (const c of candidates) {
      let score = c.sourcePriority * 10;
      if (preferredHighway && c.highway === preferredHighway) score += 25;
      if (preferredConcessionaire && c.concessionaire === preferredConcessionaire) score += 15;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  resolve(
    rawName: string,
    preferredHighway?: string,
    preferredConcessionaire?: string,
  ): CoordCandidate | null {
    const norm = normalizeName(rawName);
    if (norm.length < 2) return null;

    const known = KNOWN_EXACT_COORDS[norm];
    if (known) {
      return {
        lat: known.lat,
        lon: known.lon,
        sourcePriority: 5,
        displayName: known.canonicalName ?? rawName,
        highway: preferredHighway || known.highway,
        concessionaire: known.concessionaire || preferredConcessionaire,
      };
    }

    const exact = this.pickBest(this.byNorm.get(norm), preferredHighway, preferredConcessionaire);
    if (exact) return exact;

    const compact = normalizeCompact(rawName);
    const compactHit = this.pickBest(
      this.byCompact.get(compact),
      preferredHighway,
      preferredConcessionaire,
    );
    if (compactHit) return compactHit;

    const aliases = CURATED_NAME_ALIASES[norm];
    if (aliases) {
      for (const alias of aliases) {
        const aliasHit = this.pickBest(
          this.byNorm.get(alias),
          preferredHighway,
          preferredConcessionaire,
        );
        if (aliasHit) return aliasHit;
      }
    }

    // Try stripping trailing parenthetical or slash qualifier
    const simplified = rawName
      .replaceAll(/\([^)]*\)/g, " ")
      .split("/")[0]
      ?.trim();
    if (simplified && simplified !== rawName) {
      const simpNorm = normalizeName(simplified);
      if (simpNorm.length >= 3) {
        const hit = this.pickBest(
          this.byNorm.get(simpNorm),
          preferredHighway,
          preferredConcessionaire,
        );
        if (hit) return hit;
      }
    }

    // Token-based prefix match for unique long station names (e.g. "VILLEFRANCHE" -> "VILLEFRANCHE DE LAURAGAIS" only if highway matches)
    if (norm.length >= 5) {
      const matches: CoordCandidate[] = [];
      for (const [key, cands] of this.byNorm.entries()) {
        if (key.startsWith(`${norm} `) || norm.startsWith(`${key} `)) {
          for (const c of cands) {
            if (preferredHighway && c.highway && c.highway !== preferredHighway) continue;
            matches.push(c);
          }
        }
      }
      if (matches.length > 0 && matches.length <= 6) {
        const best = this.pickBest(matches, preferredHighway, preferredConcessionaire);
        if (best) return best;
      }
    }

    return null;
  }
}

interface OverlayJson {
  barrieres: Array<{ id: string; points: Array<[number, number]> }>;
  tarifs: Array<{ id: string; b: string; c: number; a: number }>;
  gares: Array<{ nom: string; points: Array<[number, number]> }>;
  paires: Array<[string, string, number, number, number | null]>;
}

const OverlaySchema = z.object({
  barrieres: z.array(
    z.object({
      id: z.string(),
      points: z.array(z.tuple([z.number(), z.number()])),
    }),
  ),
  tarifs: z.array(
    z.object({
      id: z.string(),
      b: z.string(),
      c: z.number(),
      a: z.number(),
    }),
  ),
  gares: z.array(
    z.object({
      nom: z.string(),
      points: z.array(z.tuple([z.number(), z.number()])),
    }),
  ),
  paires: z.array(z.tuple([z.string(), z.string(), z.number(), z.number(), z.number().nullable()])),
});

const buildCoordIndex = (overlay: OverlayJson): CoordIndex => {
  const index = new CoordIndex();

  // 1. OpenTollData GLOBAL_toll_info.csv (OSM-verified WGS84, highest priority = 4)
  const globalRows = parseCsvRows(
    readFileSync(resolve(RAW_DIR, "GLOBAL_toll_info.csv"), "utf8"),
    ";",
  );
  for (const row of globalRows) {
    const lat = parseFrenchNumber(row.lat);
    const lon = parseFrenchNumber(row.lon);
    if (lat === null || lon === null || !isValidFranceCoord(lat, lon)) continue;
    const concessionaire = normalizeConcessionaire(row.operator_osm);
    const exitNumber =
      row.operator_ref && /^\d+[A-Z]?$/i.test(row.operator_ref.trim())
        ? row.operator_ref.trim()
        : undefined;
    const cand: CoordCandidate = {
      lat,
      lon,
      sourcePriority: 4,
      displayName: row.osm_name || row.name || "",
      concessionaire: concessionaire || undefined,
      exitNumber,
    };
    if (row.name) index.add(row.name, cand);
    if (row.osm_name) index.add(row.osm_name, cand);
  }

  // 2. DGITM Free-Flow Gantries 2026 (WGS84, priority = 3.5)
  const ffRows = parseCsvRows(
    readFileSync(resolve(RAW_DIR, "portiques-free-flow-2026.csv"), "latin1"),
    ";",
  );
  for (const row of ffRows) {
    const coordsRaw = row["Coordonnées GPS"] ?? Object.values(row)[1] ?? "";
    const parts = coordsRaw.split(",").map((p) => Number(p.trim()));
    const lat = parts[0];
    const lon = parts[1];
    if (lat === undefined || lon === undefined || !isValidFranceCoord(lat, lon)) continue;
    const name = row.Nom ?? "";
    const highway = normalizeHighway(row.Autoroute);
    const concessionaire = normalizeConcessionaire(row.Concessionnaire);
    index.add(name, {
      lat,
      lon,
      sourcePriority: 3.5,
      displayName: name,
      highway: highway || undefined,
      concessionaire: concessionaire || undefined,
    });
  }

  // 3. MTE Official Gares de péage 2025 (1,266 rows, Lambert-93 -> WGS84, priority = 3)
  const mteRows = parseCsvRows(readFileSync(resolve(RAW_DIR, "gares-peage-2025.csv"), "utf8"), ";");
  const mteGrouped = new Map<
    string,
    { sumLat: number; sumLon: number; count: number; name: string; highway: string }
  >();
  for (const row of mteRows) {
    const x = parseFrenchNumber(row.x);
    const y = parseFrenchNumber(row.y);
    const name = row.nomGare?.trim();
    if (x === null || y === null || !name) continue;
    const pt = lambert93ToWgs84(x, y);
    if (!isValidFranceCoord(pt.lat, pt.lon)) continue;
    const highway = extractHighwayFromMteRoute(row.route ?? "");
    const key = `${normalizeName(name)}|${highway}`;
    const existing = mteGrouped.get(key);
    if (existing) {
      existing.sumLat += pt.lat;
      existing.sumLon += pt.lon;
      existing.count += 1;
    } else {
      mteGrouped.set(key, {
        sumLat: pt.lat,
        sumLon: pt.lon,
        count: 1,
        name,
        highway,
      });
    }
  }
  for (const entry of mteGrouped.values()) {
    index.add(entry.name, {
      lat: entry.sumLat / entry.count,
      lon: entry.sumLon / entry.count,
      sourcePriority: 3,
      displayName: entry.name,
      highway: entry.highway,
    });
  }

  // 4. Supplementary verified GPS coordinates from convoyage-app overlay (priority = 2)
  for (const gare of overlay.gares) {
    const pt = gare.points[0];
    if (!pt) continue;
    const [lat, lon] = pt;
    if (!isValidFranceCoord(lat, lon)) continue;
    index.add(gare.nom, {
      lat,
      lon,
      sourcePriority: 2,
      displayName: gare.nom,
    });
  }

  return index;
};

interface RawPair {
  fromName: string;
  toName: string;
  fromHighway?: string;
  toHighway?: string;
  fromExit?: string;
  toExit?: string;
  c1: number;
  c2: number;
  c5: number;
  concessionaire: string;
  priority: number;
}

const formatDisplayName = (raw: string): string => {
  const cleaned = raw.trim().replaceAll(/\s+/g, " ");
  if (cleaned === cleaned.toUpperCase() && cleaned.length > 3) {
    return cleaned
      .toLowerCase()
      .replaceAll(
        /(^|[\s\-/(])([a-zà-öø-ÿ])/g,
        (_m, sep: string, ch: string) => sep + ch.toUpperCase(),
      );
  }
  return cleaned;
};

const inferOpenBarrierMeta = (
  barrierId: string,
): { name: string; concessionaire: string; highway: string } => {
  const id = barrierId.toLowerCase();
  const pretty = barrierId
    .replace(
      /^(albea|atlandes|atmb|cevm|sanef|escota|arcos|aprr-area-ouvert|aprr-ouvert|adelac-ouvert|cofiroute-ouvert|sapn|bpnl)-/,
      "",
    )
    .replaceAll(/-syst-me-ouvert$/g, "")
    .replaceAll("-", " ")
    .replaceAll(/\b\w/g, (ch) => ch.toUpperCase());

  if (id.startsWith("albea-")) return { name: pretty, concessionaire: "ALBEA", highway: "A150" };
  if (id.startsWith("atlandes-"))
    return { name: pretty, concessionaire: "ATLANDES", highway: "A63" };
  if (id.startsWith("atmb-")) return { name: pretty, concessionaire: "ATMB", highway: "A40" };
  if (id.startsWith("cevm-") || id === "viaduc-millau")
    return { name: "Viaduc de Millau", concessionaire: "CEVM", highway: "A75" };
  if (id.startsWith("sanef-la-neuvillette"))
    return { name: "Reims La Neuvillette", concessionaire: "SANEF", highway: "A26" };
  if (id.startsWith("sanef-survilliers"))
    return { name: "Survilliers / Saint-Witz", concessionaire: "SANEF", highway: "A1" };
  if (id.startsWith("sanef-")) return { name: pretty, concessionaire: "SANEF", highway: "A1" };
  if (id.startsWith("sapn-chambourcy"))
    return { name: "Chambourcy (A14)", concessionaire: "SAPN", highway: "A14" };
  if (id.startsWith("sapn-")) return { name: pretty, concessionaire: "SAPN", highway: "A13" };
  if (id.startsWith("escota-")) return { name: pretty, concessionaire: "ESCOTA", highway: "A8" };
  if (id.startsWith("arcos-"))
    return { name: `Ittenheim (${pretty})`, concessionaire: "ARCOS", highway: "A355" };
  if (id.startsWith("adelac-")) return { name: pretty, concessionaire: "ADELAC", highway: "A41" };
  if (id.startsWith("cofiroute-"))
    return { name: pretty, concessionaire: "COFIROUTE", highway: "A10" };
  if (id.startsWith("aprr-ouvert-dordives"))
    return { name: "Dordives", concessionaire: "APRR", highway: "A77" };
  if (id.startsWith("aprr-area-ouvert-")) {
    if (id.includes("chesnes") || id.includes("saint-exupery") || id.includes("chignin"))
      return { name: pretty, concessionaire: "AREA", highway: "A43" };
    if (id.includes("crozet")) return { name: "Le Crozet", concessionaire: "AREA", highway: "A51" };
    if (id.includes("cruseilles"))
      return { name: "Cruseilles", concessionaire: "AREA", highway: "A41" };
    if (id.includes("scionzier") || id.includes("bonneville") || id.includes("cluses"))
      return { name: pretty, concessionaire: "ATMB", highway: "A40" };
    if (id.includes("fontaine-lariviere"))
      return { name: "Fontaine-Larivière", concessionaire: "APRR", highway: "A36" };
    if (id.includes("lusse"))
      return { name: "Tunnel Maurice-Lemaire", concessionaire: "APRR", highway: "N159" };
    if (id.includes("myennes") || id.includes("tourneau"))
      return { name: pretty, concessionaire: "APRR", highway: "A77" };
    if (id.includes("vichy")) return { name: "Vichy", concessionaire: "APRR", highway: "A719" };
    if (id.includes("crottet")) return { name: "Crottet", concessionaire: "APRR", highway: "A406" };
    return { name: pretty, concessionaire: "APRR", highway: "A46" };
  }
  if (id === "pont-normandie")
    return { name: "Pont de Normandie", concessionaire: "AUTRE", highway: "A29" };
  if (id === "pont-tancarville")
    return { name: "Pont de Tancarville", concessionaire: "AUTRE", highway: "N182" };
  if (id === "tunnel-puymorens")
    return { name: "Tunnel du Puymorens", concessionaire: "AUTRE", highway: "N20" };
  if (id === "tunnel-mont-blanc-fr")
    return { name: "Tunnel du Mont-Blanc", concessionaire: "ATMB", highway: "N205" };
  if (id === "tunnel-frejus-fr")
    return { name: "Tunnel du Fréjus", concessionaire: "SFTRF", highway: "A43" };
  if (id === "bpnl-periph-nord-lyon")
    return { name: "Périphérique Nord de Lyon", concessionaire: "AUTRE", highway: "D383" };
  return { name: pretty, concessionaire: "AUTRE", highway: "A" };
};

const inferOverlayConcessionaire = (
  lat: number,
  lon: number,
  name: string,
): { concessionaire: string; highway: string } => {
  const norm = normalizeName(name);
  if (
    norm.includes("CHAMANT") ||
    norm.includes("DOURGES") ||
    norm.includes("FRESNES") ||
    norm.includes("SENLIS") ||
    norm.includes("ARRAS") ||
    norm.includes("ROYE") ||
    norm.includes("COMPIEGNE") ||
    norm.includes("CALAIS") ||
    norm.includes("ABBEVILLE") ||
    norm.includes("AMIENS") ||
    norm.includes("AUMALE") ||
    norm.includes("BOULOGNE") ||
    norm.includes("SAINT OMER") ||
    norm.includes("STRASBOURG") ||
    norm.includes("SCHWINDRATZHEIM") ||
    norm.includes("MEAUX") ||
    norm.includes("COUTEVROULT") ||
    norm.includes("CHATEAU THIERRY") ||
    norm.includes("REIMS") ||
    norm.includes("METZ") ||
    norm.includes("BOULAY") ||
    norm.includes("FORBACH") ||
    norm.includes("SARREBOURG") ||
    norm.includes("SAINT AVOLD") ||
    norm.includes("VERDUN") ||
    norm.includes("CHALONS") ||
    norm.includes("SAINT QUENTIN") ||
    norm.includes("CAMBRAI") ||
    norm.includes("LAON") ||
    norm.includes("VALENCIENNES")
  ) {
    return { concessionaire: "SANEF", highway: lon > 3.5 && lat < 49.5 ? "A4" : "A1" };
  }
  if (
    norm.includes("BEUZEVILLE") ||
    norm.includes("HEUDEBOUVILLE") ||
    norm.includes("BUCHELAY") ||
    norm.includes("DOZULE") ||
    norm.includes("BOURG ACHARD") ||
    norm.includes("BOURNEVILLE") ||
    norm.includes("CAEN") ||
    norm.includes("BONNIERES") ||
    norm.includes("INCARVILLE") ||
    norm.includes("TOUTAINVILLE") ||
    norm.includes("TROARN") ||
    norm.includes("CAGNY") ||
    norm.includes("QUETTEVILLE") ||
    norm.includes("BOLBEC") ||
    norm.includes("FECAMP") ||
    norm.includes("ROMAIN DE COLBOSC") ||
    norm.includes("LE HAVRE") ||
    norm.includes("BEAUTOT")
  ) {
    return { concessionaire: "SAPN", highway: lat > 49.42 && lon < 1.0 ? "A29" : "A13" };
  }
  if (norm.includes("MONTET") || norm.includes("MONTBEUGNY") || norm.includes("MOLINET")) {
    return { concessionaire: "ALIAE", highway: "A79" };
  }
  if (
    norm.includes("BONNEVILLE") ||
    norm.includes("CLUSES") ||
    norm.includes("GAILLARD") ||
    norm.includes("LE FAYET") ||
    norm.includes("SCIENTRIER") ||
    norm.includes("SCIONZIER")
  ) {
    return { concessionaire: "ATMB", highway: "A40" };
  }
  if (
    norm.includes("MODANE") ||
    norm.includes("SAINT MICHEL DE MAURIENNE") ||
    norm.includes("HERMILLON")
  ) {
    return { concessionaire: "SFTRF", highway: "A43" };
  }
  if (
    norm.includes("ADOUR") ||
    norm.includes("MONT DE MARSAN") ||
    norm.includes("LANGON") ||
    norm.includes("BAZAS")
  ) {
    return { concessionaire: "ALIENOR", highway: "A65" };
  }
  if (
    norm.includes("BERNAY") ||
    norm.includes("ORBEC") ||
    norm.includes("BRIONNE") ||
    norm.includes("GACE") ||
    norm.includes("SEES")
  ) {
    return { concessionaire: "ALIS", highway: "A28" };
  }
  if (norm.includes("FALAISE") || norm.includes("ARGENTAN")) {
    return { concessionaire: "ALICORNE", highway: "A88" };
  }
  if (lat >= 48.35 && lon >= 5.5) return { concessionaire: "SANEF", highway: "A4" };
  if (lat > 49.0 && lon > 1.5) return { concessionaire: "SANEF", highway: "A1" };
  if (lat > 48.9 && lon <= 1.5) return { concessionaire: "SAPN", highway: "A13" };
  return { concessionaire: "ASF", highway: "A" };
};

const main = async (): Promise<void> => {
  const refresh = process.argv.includes("--refresh");
  await downloadAllSources(refresh);

  // Verify Lambert-93 -> WGS84 on known official MTE plazas
  const mtePreview = parseCsvRows(
    readFileSync(resolve(RAW_DIR, "gares-peage-2025.csv"), "utf8"),
    ";",
  );
  const fleuryRow = mtePreview.find((r) =>
    (r.nomGare ?? "").toLowerCase().includes("fleury-en-biere"),
  );
  const vienneRow = mtePreview.find((r) => (r.nomGare ?? "").toLowerCase() === "vienne");
  if (fleuryRow && vienneRow) {
    const fx = parseFrenchNumber(fleuryRow.x);
    const fy = parseFrenchNumber(fleuryRow.y);
    const vx = parseFrenchNumber(vienneRow.x);
    const vy = parseFrenchNumber(vienneRow.y);
    if (fx !== null && fy !== null && vx !== null && vy !== null) {
      const fPt = lambert93ToWgs84(fx, fy);
      const vPt = lambert93ToWgs84(vx, vy);
      console.log(
        `Lambert-93 check: Fleury-en-Bière=(${fPt.lat.toFixed(5)}, ${fPt.lon.toFixed(5)}) | Vienne=(${vPt.lat.toFixed(5)}, ${vPt.lon.toFixed(5)})`,
      );
    }
  }

  const overlayRaw: unknown = JSON.parse(
    readFileSync(resolve(RAW_DIR, "convoyage-peages-overlay.json"), "utf8"),
  );
  const overlay = OverlaySchema.parse(overlayRaw);
  const coordIndex = buildCoordIndex(overlay);

  const rawPairs: RawPair[] = [];

  // 1. APRR 2026-02 CSV (primary)
  const aprrRows = parseCsvRows(readFileSync(resolve(RAW_DIR, "aprr-2026-02.csv"), "utf8"), ",");
  for (const row of aprrRows) {
    const fromName = row.gare_entree ?? "";
    const toName = row.gare_sortie ?? "";
    if (!fromName || !toName || fromName === toName) continue;
    if (fromName.includes("Système Ouvert") || toName.includes("Système Ouvert")) continue;
    // Skip PDF-scraper-concatenated multi-station anomalies in the raw APRR CSV
    if (toName.startsWith("(") || toName.startsWith("CH.RENAULT ") || toName.length > 34) continue;
    const c1 = parseFrenchNumber(row.tarif_classe_1);
    const c2 = parseFrenchNumber(row.tarif_classe_2);
    const c5 = parseFrenchNumber(row.tarif_classe_5);
    if (c1 === null || c2 === null || c5 === null || c1 <= 0) continue;
    rawPairs.push({
      fromName,
      toName,
      c1: roundPrice(c1),
      c2: roundPrice(c2),
      c5: roundPrice(c5),
      concessionaire: "APRR",
      priority: 10,
    });
  }

  // 2. AREA 2026-02 CSV (primary)
  const areaRows = parseCsvRows(readFileSync(resolve(RAW_DIR, "area-2026-02.csv"), "utf8"), ",");
  for (const row of areaRows) {
    const fromName = row.libelle_gare_entree ?? "";
    const toName = row.libelle_gare_sortie ?? "";
    if (!fromName || !toName || fromName === toName) continue;
    if (fromName.includes("Système Ouvert") || toName.includes("Système Ouvert")) continue;
    const c1 = parseFrenchNumber(row.tarif_classe_1);
    const c2 = parseFrenchNumber(row.tarif_classe_2);
    const c5 = parseFrenchNumber(row.tarif_classe_5);
    if (c1 === null || c2 === null || c5 === null || c1 <= 0) continue;
    rawPairs.push({
      fromName,
      toName,
      c1: roundPrice(c1),
      c2: roundPrice(c2),
      c5: roundPrice(c5),
      concessionaire: "AREA",
      priority: 10,
    });
  }

  // 3. ASF 2026 TXT (primary)
  const asfRows = parseCsvRows(readFileSync(resolve(RAW_DIR, "Tarifs_ASF.txt"), "utf8"), ";");
  for (const row of asfRows) {
    const fromName = row.nom_entree ?? "";
    const toName = row.nom_sortie ?? "";
    if (!fromName || !toName || fromName === toName) continue;
    const c1 = parseFrenchNumber(row.classe1);
    const c2 = parseFrenchNumber(row.classe2);
    const c5 = parseFrenchNumber(row.classe5);
    if (c1 === null || c2 === null || c5 === null || c1 <= 0) continue;
    rawPairs.push({
      fromName,
      toName,
      fromHighway: normalizeHighway(row.autoroute_entree),
      toHighway: normalizeHighway(row.autoroute_sortie),
      c1: roundPrice(c1),
      c2: roundPrice(c2),
      c5: roundPrice(c5),
      concessionaire: "ASF",
      priority: 10,
    });
  }

  // 4. Cofiroute + Arcour 2026 TXT (primary)
  const cofRows = parseCsvRows(
    readFileSync(resolve(RAW_DIR, "Tarifs_Cofiroute_Arcour.txt"), "utf8"),
    ";",
  );
  for (const row of cofRows) {
    const fromName = row.nom_entree ?? "";
    const toName = row.nom_sortie ?? "";
    if (!fromName || !toName || fromName === toName) continue;
    const c1 = parseFrenchNumber(row.classe1);
    const c2 = parseFrenchNumber(row.classe2);
    const c5 = parseFrenchNumber(row.classe5);
    if (c1 === null || c2 === null || c5 === null || c1 <= 0) continue;
    const fromExit =
      row.echangeur_entree && row.echangeur_entree !== "-"
        ? row.echangeur_entree.trim()
        : undefined;
    const toExit =
      row.echangeur_sortie && row.echangeur_sortie !== "-"
        ? row.echangeur_sortie.trim()
        : undefined;
    rawPairs.push({
      fromName,
      toName,
      fromHighway: normalizeHighway(row.autoroute_entree),
      toHighway: normalizeHighway(row.autoroute_sortie),
      fromExit,
      toExit,
      c1: roundPrice(c1),
      c2: roundPrice(c2),
      c5: roundPrice(c5),
      concessionaire: "COFIROUTE",
      priority: 10,
    });
  }

  // 5. ESCOTA 2026 TXT (primary)
  const escRows = parseCsvRows(readFileSync(resolve(RAW_DIR, "Tarifs_ESCOTA.txt"), "utf8"), ";");
  for (const row of escRows) {
    const fromName = row.nom_entree ?? "";
    const toName = row.nom_sortie ?? "";
    if (!fromName || !toName || fromName === toName) continue;
    const c1 = parseFrenchNumber(row.classe1);
    const c2 = parseFrenchNumber(row.classe2);
    const c5 = parseFrenchNumber(row.classe5);
    if (c1 === null || c2 === null || c5 === null || c1 <= 0) continue;
    rawPairs.push({
      fromName,
      toName,
      fromHighway: normalizeHighway(row.autoroute_entree),
      toHighway: normalizeHighway(row.autoroute_sortie),
      c1: roundPrice(c1),
      c2: roundPrice(c2),
      c5: roundPrice(c5),
      concessionaire: "ESCOTA",
      priority: 10,
    });
  }

  // 6. Supplementary 2026 verified closed pairs (SANEF, SAPN, ATMB, SFTRF, ALIS, ALIENOR, ALIAE, ALICORNE, etc.)
  for (const pair of overlay.paires) {
    const [fromName, toName, c1, c2] = pair;
    if (!fromName || !toName || fromName === toName || c1 <= 0 || c2 <= 0) continue;
    const fromCoord = coordIndex.resolve(fromName);
    const inferredConc = fromCoord
      ? (fromCoord.concessionaire ??
        inferOverlayConcessionaire(fromCoord.lat, fromCoord.lon, fromName).concessionaire)
      : "SANEF";
    const c5Ratio = inferredConc === "SAPN" ? 0.594 : 0.6;
    rawPairs.push({
      fromName,
      toName,
      c1: roundPrice(c1),
      c2: roundPrice(c2),
      c5: roundPrice(Math.max(0.1, roundTenth(c1 * c5Ratio))),
      concessionaire: inferredConc,
      priority: 5,
    });
  }

  // Canonicalize closed plazas with spatial + name deduplication
  interface MutablePlaza {
    id: string;
    name: string;
    exitNumber?: string;
    highway: string;
    concessionaire: string;
    lat: number;
    lon: number;
    priority: number;
    aliases: Set<string>;
  }

  const closedPlazas: MutablePlaza[] = [];
  const stationKeyToPlazaId = new Map<string, string>();
  const matchedStationNames = new Set<string>();
  const unmatchedStationNames = new Set<string>();

  const getOrCreateClosedPlaza = (params: {
    rawName: string;
    highway?: string;
    concessionaire: string;
    exitNumber?: string;
    priority: number;
  }): string | null => {
    const { rawName, highway, concessionaire, exitNumber, priority } = params;
    const cacheKey = `${normalizeName(rawName)}|${highway ?? ""}|${concessionaire}`;
    const cached = stationKeyToPlazaId.get(cacheKey);
    if (cached) return cached;

    const coord = coordIndex.resolve(rawName, highway, concessionaire);
    if (!coord) {
      unmatchedStationNames.add(`${concessionaire}:${rawName}`);
      return null;
    }
    matchedStationNames.add(`${concessionaire}:${rawName}`);

    const resolvedLat = roundCoord(coord.lat);
    const resolvedLon = roundCoord(coord.lon);
    const norm = normalizeName(rawName);

    // Deduplicate against existing plaza within 650m
    let existing: MutablePlaza | undefined;
    for (const candidate of closedPlazas) {
      const distKm = haversineKm(candidate.lat, candidate.lon, resolvedLat, resolvedLon);
      if (distKm <= 0.65) {
        existing = candidate;
        break;
      }
    }

    if (existing) {
      existing.aliases.add(norm);
      if (priority > existing.priority) {
        existing.priority = priority;
        if (highway) existing.highway = highway;
        if (concessionaire) existing.concessionaire = concessionaire;
      }
      if (!existing.exitNumber && (exitNumber || coord.exitNumber)) {
        existing.exitNumber = exitNumber ?? coord.exitNumber;
      }
      if (existing.highway === "A" && (highway || coord.highway)) {
        existing.highway = highway || coord.highway || "A";
      }
      stationKeyToPlazaId.set(cacheKey, existing.id);
      return existing.id;
    }

    const inferred = inferOverlayConcessionaire(resolvedLat, resolvedLon, rawName);
    const finalHighway = highway || coord.highway || inferred.highway || "A";
    const finalConcessionaire =
      priority >= 10
        ? concessionaire
        : coord.concessionaire || inferred.concessionaire || concessionaire;
    const displayName = coord.sourcePriority >= 5 ? coord.displayName : formatDisplayName(rawName);
    const baseSlug = slugify(displayName) || "plaza";
    let id = `${finalConcessionaire.toLowerCase()}-${baseSlug}`;
    let suffix = 2;
    while (closedPlazas.some((p) => p.id === id)) {
      id = `${finalConcessionaire.toLowerCase()}-${baseSlug}-${suffix}`;
      suffix += 1;
    }

    const created: MutablePlaza = {
      id,
      name: displayName,
      exitNumber: exitNumber ?? coord.exitNumber,
      highway: finalHighway,
      concessionaire: finalConcessionaire,
      lat: resolvedLat,
      lon: resolvedLon,
      priority,
      aliases: new Set([norm]),
    };
    closedPlazas.push(created);
    stationKeyToPlazaId.set(cacheKey, id);
    return id;
  };

  // Sort pairs so primary official sources (priority 10) register plazas and tariffs first
  rawPairs.sort((a, b) => b.priority - a.priority);

  interface DirectedTariff {
    tuple: TariffTuple;
    priority: number;
    concessionaire: string;
  }

  const directedTariffs = new Map<string, DirectedTariff>();
  const adjacency = new Map<string, Set<string>>();

  const addAdjacency = (a: string, b: string): void => {
    const setA = adjacency.get(a);
    if (setA) setA.add(b);
    else adjacency.set(a, new Set([b]));
    const setB = adjacency.get(b);
    if (setB) setB.add(a);
    else adjacency.set(b, new Set([a]));
  };

  for (const pair of rawPairs) {
    const fromId = getOrCreateClosedPlaza({
      rawName: pair.fromName,
      highway: pair.fromHighway,
      concessionaire: pair.concessionaire,
      exitNumber: pair.fromExit,
      priority: pair.priority,
    });
    const toId = getOrCreateClosedPlaza({
      rawName: pair.toName,
      highway: pair.toHighway,
      concessionaire: pair.concessionaire,
      exitNumber: pair.toExit,
      priority: pair.priority,
    });
    if (!fromId || !toId || fromId === toId) continue;

    const dirKey = `${fromId}|${toId}`;
    const revKey = `${toId}|${fromId}`;
    const existing = directedTariffs.get(dirKey);
    const existingRev = directedTariffs.get(revKey);

    if (existing && existing.priority > pair.priority) continue;
    if (!existing && existingRev && existingRev.priority > pair.priority) continue;

    directedTariffs.set(dirKey, {
      tuple: [pair.c1, pair.c2, pair.c5],
      priority: pair.priority,
      concessionaire: pair.concessionaire,
    });
    addAdjacency(fromId, toId);
  }

  // Compute connected components on the closed-system tariff graph
  const plazaById = new Map<string, MutablePlaza>();
  for (const plaza of closedPlazas) {
    plazaById.set(plaza.id, plaza);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const plazaId of adjacency.keys()) {
    if (visited.has(plazaId)) continue;
    const queue: string[] = [plazaId];
    visited.add(plazaId);
    const comp: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      comp.push(current);
      const neighbors = adjacency.get(current);
      if (!neighbors) continue;
      for (const next of neighbors) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    components.push(comp);
  }

  components.sort((a, b) => b.length - a.length);

  const networkIdByPlazaId = new Map<string, string>();
  const usedNetworkIds = new Map<string, number>();

  for (const comp of components) {
    const concCounts = new Map<string, number>();
    for (const pid of comp) {
      const p = plazaById.get(pid);
      if (!p) continue;
      concCounts.set(p.concessionaire, (concCounts.get(p.concessionaire) ?? 0) + 1);
    }
    const sortedConcs = Array.from(concCounts.entries()).sort((a, b) => b[1] - a[1]);
    const topConc = sortedConcs[0]?.[0] ?? "OTHER";
    const hasAprr = (concCounts.get("APRR") ?? 0) > 5;
    const hasArea = (concCounts.get("AREA") ?? 0) > 5;

    let baseNetworkId: string;
    if (hasAprr && hasArea) {
      baseNetworkId = "aprr-area";
    } else if (topConc === "ASF") {
      baseNetworkId = "asf-closed";
    } else {
      baseNetworkId = topConc.toLowerCase();
    }

    const count = (usedNetworkIds.get(baseNetworkId) ?? 0) + 1;
    usedNetworkIds.set(baseNetworkId, count);
    const finalNetworkId = count === 1 ? baseNetworkId : `${baseNetworkId}-${count}`;

    for (const pid of comp) {
      networkIdByPlazaId.set(pid, finalNetworkId);
    }
  }

  const finalPlazas: TollPlaza[] = [];
  const finalTariffs: Record<string, TariffTuple> = {};

  for (const plaza of closedPlazas) {
    const networkId = networkIdByPlazaId.get(plaza.id);
    if (!networkId) continue;
    finalPlazas.push({
      id: plaza.id,
      name: plaza.name,
      ...(plaza.exitNumber ? { exitNumber: plaza.exitNumber } : {}),
      highway: plaza.highway,
      concessionaire: plaza.concessionaire,
      networkId,
      system: "closed",
      lat: plaza.lat,
      lon: plaza.lon,
    });
  }

  // Compact closed tariffs: store sorted canonical key when symmetric, both keys if asymmetric
  const processedPairs = new Set<string>();
  for (const [dirKey, entry] of directedTariffs.entries()) {
    const [fromId, toId] = dirKey.split("|");
    if (!fromId || !toId) continue;
    const canonicalKey = fromId < toId ? `${fromId}|${toId}` : `${toId}|${fromId}`;
    if (processedPairs.has(canonicalKey)) continue;
    processedPairs.add(canonicalKey);

    const revEntry = directedTariffs.get(`${toId}|${fromId}`);
    if (!revEntry) {
      finalTariffs[canonicalKey] = entry.tuple;
      continue;
    }

    const same =
      entry.tuple[0] === revEntry.tuple[0] &&
      entry.tuple[1] === revEntry.tuple[1] &&
      entry.tuple[2] === revEntry.tuple[2];
    if (same) {
      finalTariffs[canonicalKey] = entry.tuple;
    } else {
      finalTariffs[`${fromId}|${toId}`] = entry.tuple;
      finalTariffs[`${toId}|${fromId}`] = revEntry.tuple;
    }
  }

  // Ingest open barriers from convoyage-app verified 2026 overlay
  const openTariffsByBarrier = new Map<string, { c1?: number; c2?: number; c5?: number }>();
  for (const t of overlay.tarifs) {
    const cur = openTariffsByBarrier.get(t.b) ?? {};
    if (t.c === 1 && cur.c1 === undefined) cur.c1 = roundPrice(t.a);
    if (t.c === 2 && cur.c2 === undefined) cur.c2 = roundPrice(t.a);
    if (t.c === 5 && cur.c5 === undefined) cur.c5 = roundPrice(t.a);
    openTariffsByBarrier.set(t.b, cur);
  }

  const seenOpenCoords: Array<{ lat: number; lon: number; id: string }> = [];
  for (const barrier of overlay.barrieres) {
    const pt = barrier.points[0];
    if (!pt) continue;
    const [rawLat, rawLon] = pt;
    if (!isValidFranceCoord(rawLat, rawLon)) continue;
    const prices = openTariffsByBarrier.get(barrier.id);
    if (!prices || prices.c1 === undefined || prices.c1 <= 0) continue;

    const lat = roundCoord(rawLat);
    const lon = roundCoord(rawLon);
    // Skip duplicate CEVM Millau entry if already added within 6km under same concessionaire
    if (
      barrier.id === "viaduc-millau" &&
      seenOpenCoords.some((s) => s.id === "open-cevm-saint-germain")
    ) {
      continue;
    }

    const c1 = prices.c1;
    const c2 = prices.c2 ?? roundPrice(roundTenth(c1 * 1.5));
    const c5 = prices.c5 ?? roundPrice(Math.max(0.1, roundTenth(c1 * 0.6)));
    const meta = inferOpenBarrierMeta(barrier.id);
    const id = `open-${slugify(barrier.id)}`;

    seenOpenCoords.push({ lat, lon, id });
    finalPlazas.push({
      id,
      name: meta.name,
      highway: meta.highway,
      concessionaire: meta.concessionaire,
      networkId: `open-${meta.concessionaire.toLowerCase()}`,
      system: "open",
      lat,
      lon,
    });
    finalTariffs[`${id}|${id}`] = [c1, c2, c5];
  }

  // Sort plazas deterministically
  finalPlazas.sort((a, b) => a.id.localeCompare(b.id));

  // Build sources summary
  const plazaCountByConc = new Map<string, number>();
  const plazaConcById = new Map<string, string>();
  for (const p of finalPlazas) {
    plazaCountByConc.set(p.concessionaire, (plazaCountByConc.get(p.concessionaire) ?? 0) + 1);
    plazaConcById.set(p.id, p.concessionaire);
  }

  const tariffCountByConc = new Map<string, number>();
  for (const key of Object.keys(finalTariffs)) {
    const fromId = key.split("|")[0];
    const conc = (fromId ? plazaConcById.get(fromId) : undefined) ?? "AUTRE";
    tariffCountByConc.set(conc, (tariffCountByConc.get(conc) ?? 0) + 1);
  }

  const sources: TollSource[] = Array.from(plazaCountByConc.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([concessionaire, plazaCount]) => ({
      concessionaire,
      year: 2026,
      url: SOURCE_URLS[concessionaire] ?? SOURCE_URLS.AUTRE ?? "",
      plazaCount,
      tariffCount: tariffCountByConc.get(concessionaire) ?? 0,
    }));

  const dataset: TollDataset = {
    version: "2026.02",
    updatedAt: new Date().toISOString(),
    sources,
    plazas: finalPlazas,
    tariffs: finalTariffs,
  };

  const validated = TollDatasetSchema.parse(dataset);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const jsonText = JSON.stringify(validated);
  writeFileSync(OUTPUT_PATH, jsonText, "utf8");

  const sizeMb = (Buffer.byteLength(jsonText, "utf8") / (1024 * 1024)).toFixed(2);
  const totalStationsSeen = matchedStationNames.size + unmatchedStationNames.size;
  const matchRate =
    totalStationsSeen > 0
      ? ((matchedStationNames.size / totalStationsSeen) * 100).toFixed(1)
      : "0.0";

  console.log("\n=== Toll Dataset 2026 Build Report ===");
  console.log(`Output: ${OUTPUT_PATH} (${sizeMb} MB)`);
  console.log(
    `Station coordinate match rate: ${matchedStationNames.size}/${totalStationsSeen} (${matchRate}%)`,
  );
  console.log(
    `Total plazas: ${validated.plazas.length} (closed: ${validated.plazas.filter((p) => p.system === "closed").length}, open: ${validated.plazas.filter((p) => p.system === "open").length})`,
  );
  console.log(`Total tariff entries: ${Object.keys(validated.tariffs).length}`);
  console.log(`Closed connected components: ${components.length}`);

  console.log("\nBy concessionaire:");
  for (const s of validated.sources) {
    console.log(
      `  ${s.concessionaire.padEnd(12)} plazas=${String(s.plazaCount).padStart(4)}  tariffs=${String(s.tariffCount).padStart(5)}`,
    );
  }

  // Spot-checks for major French corridors
  const lookup = (fromQuery: string, toQuery: string): string => {
    const findPlaza = (query: string): TollPlaza | undefined => {
      const q = normalizeName(query);
      return (
        validated.plazas.find((p) => normalizeName(p.name) === q) ??
        validated.plazas.find((p) => normalizeName(p.name).includes(q)) ??
        validated.plazas.find((p) => p.id.includes(slugify(query)))
      );
    };
    const a = findPlaza(fromQuery);
    const b = findPlaza(toQuery);
    if (!a || !b) {
      return `MISSING PLAZA (from=${a?.id ?? "NONE"}, to=${b?.id ?? "NONE"})`;
    }
    const tuple = validated.tariffs[`${a.id}|${b.id}`] ?? validated.tariffs[`${b.id}|${a.id}`];
    if (!tuple) {
      return `NO DIRECT TARIFF (${a.name} [${a.networkId}] -> ${b.name} [${b.networkId}])`;
    }
    return `${a.name} (${a.lat},${a.lon}) -> ${b.name} (${b.lat},${b.lon}) [${a.networkId}]: C1=${tuple[0].toFixed(2)}€ C2=${tuple[1].toFixed(2)}€ C5=${tuple[2].toFixed(2)}€`;
  };

  console.log("\nCorridor spot-checks:");
  console.log("  Paris -> Lyon (A6):       ", lookup("Fleury-en-Bière", "Villefranche-Limas"));
  console.log("  Lyon -> Marseille (A7):   ", lookup("Vienne", "Lançon-de-Provence"));
  console.log("  Paris -> Tours N (A10):   ", lookup("Saint-Arnoult", "Tours Centre (Monnaie)"));
  console.log("  Tours S -> Bordeaux (A10):", lookup("Tours Centre (Sorigny)", "Virsac"));
  console.log("  Paris -> Lille (A1):      ", lookup("Chamant", "Fresnes-lès-Montauban"));
  console.log("  Paris -> Strasbourg (A4): ", lookup("Coutevroult", "Schwindratzheim"));
  console.log("  Meaux -> Strasbourg (A4): ", lookup("Meaux / Crécy", "Schwindratzheim"));
  console.log("  Paris -> Angers (A11):    ", lookup("Saint-Arnoult", "Angers (Corze)"));
  console.log("  Angers -> Ancenis (A11):  ", lookup("Angers", "Ancenis"));
  console.log("  Ancenis -> Nantes (A11):  ", lookup("Ancenis", "Nantes (Carquefou)"));
  console.log("  Paris/Rouen -> Caen (A13):", lookup("Heudebouville", "Beuzeville"));
};

await main();
