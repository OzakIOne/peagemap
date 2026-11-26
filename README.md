# PeageMap

Carte interactive des péages autoroutiers en France pour sélectionner un trajet A → B, modifier chaque section de péage (fractionnement sortie/ré-entrée ou évitement), et visualiser l'itinéraire optimisé en coût.

## Stack

- **TanStack Start + SolidJS** (`@tanstack/solid-start`, `@tanstack/solid-router`, `@tanstack/solid-query`, `solid-js`)
- **MapLibre GL JS** (WebGL 60fps, styles Carto Dark Matter & OpenFreeMap Liberty)
- **OSRM + Valhalla + Photon** (routing autoroute, itinéraire sans péage, géocodage open-source sans clé API)
- **Tailwind CSS v4**, **TypeScript 7**, **Vite 8**, **Vitest**, **Oxlint** (`--type-check --type-aware`) & **Oxfmt**

## Données péages 2026

Générées de manière reproductible par `scripts/build-toll-dataset.ts` dans `public/data/tolls-fr-2026.json` :

- **579 gares & barrières** (534 système fermé + 45 système ouvert) géolocalisées en WGS84 (reprojection Lambert-93 `EPSG:2154` → WGS84)
- **16 624 tarifs 2026** (Classes 1, 2, 5) couvrant 17 concessionnaires français (APRR, AREA, ASF, COFIROUTE, SANEF, ESCOTA, SAPN, ALIENOR, ATMB, ALIAE, ADELAC, ARCOS, ATLANDES, ALBEA, CEVM, SFTRF…)

## Commandes

```bash
pnpm install
pnpm dev          # Lance l'app sur http://localhost:3000
pnpm data:build   # Regénère public/data/tolls-fr-2026.json depuis les sources officielles
pnpm check        # typecheck + lint:check + fmt + test
pnpm build        # Build client + SSR
```
