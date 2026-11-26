import type { PlaceSuggestion } from "~/domain/toll-types";

export const formatEur = (amount: number): string =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

export const formatDuration = (totalMinutes: number): string => {
  const rounded = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
};

export const formatKm = (km: number): string => `${Math.round(km)} km`;

export interface PresetTrip {
  id: string;
  label: string;
  origin: PlaceSuggestion;
  destination: PlaceSuggestion;
}

export const PRESET_TRIPS: PresetTrip[] = [
  {
    id: "paris-lyon",
    label: "Paris → Lyon",
    origin: {
      id: "preset-paris",
      label: "Paris",
      subtitle: "Île-de-France",
      lon: 2.3522,
      lat: 48.8566,
    },
    destination: {
      id: "preset-lyon",
      label: "Lyon",
      subtitle: "Auvergne-Rhône-Alpes",
      lon: 4.8357,
      lat: 45.764,
    },
  },
  {
    id: "paris-marseille",
    label: "Paris → Marseille",
    origin: {
      id: "preset-paris",
      label: "Paris",
      subtitle: "Île-de-France",
      lon: 2.3522,
      lat: 48.8566,
    },
    destination: {
      id: "preset-marseille",
      label: "Marseille",
      subtitle: "Provence-Alpes-Côte d’Azur",
      lon: 5.3698,
      lat: 43.2965,
    },
  },
  {
    id: "paris-bordeaux",
    label: "Paris → Bordeaux",
    origin: {
      id: "preset-paris",
      label: "Paris",
      subtitle: "Île-de-France",
      lon: 2.3522,
      lat: 48.8566,
    },
    destination: {
      id: "preset-bordeaux",
      label: "Bordeaux",
      subtitle: "Nouvelle-Aquitaine",
      lon: -0.5792,
      lat: 44.8378,
    },
  },
  {
    id: "paris-lille",
    label: "Paris → Lille",
    origin: {
      id: "preset-paris",
      label: "Paris",
      subtitle: "Île-de-France",
      lon: 2.3522,
      lat: 48.8566,
    },
    destination: {
      id: "preset-lille",
      label: "Lille",
      subtitle: "Hauts-de-France",
      lon: 3.0573,
      lat: 50.6292,
    },
  },
  {
    id: "paris-strasbourg",
    label: "Paris → Strasbourg",
    origin: {
      id: "preset-paris",
      label: "Paris",
      subtitle: "Île-de-France",
      lon: 2.3522,
      lat: 48.8566,
    },
    destination: {
      id: "preset-strasbourg",
      label: "Strasbourg",
      subtitle: "Grand Est",
      lon: 7.7521,
      lat: 48.5734,
    },
  },
  {
    id: "paris-nantes",
    label: "Paris → Nantes",
    origin: {
      id: "preset-paris",
      label: "Paris",
      subtitle: "Île-de-France",
      lon: 2.3522,
      lat: 48.8566,
    },
    destination: {
      id: "preset-nantes",
      label: "Nantes",
      subtitle: "Pays de la Loire",
      lon: -1.5536,
      lat: 47.2184,
    },
  },
];
