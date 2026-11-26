import { createQuery } from "@tanstack/solid-query";
import { Loader2, MapPin, X } from "lucide-solid";
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { PlaceSuggestion } from "~/domain/toll-types";
import { searchPlaces } from "~/server/routing";

interface PlaceInputProps {
  label: string;
  placeholder: string;
  dotColorClass: string;
  badgeText?: string;
  value: PlaceSuggestion | null;
  onSelect: (place: PlaceSuggestion) => void;
  onClear?: () => void;
}

export const PlaceInput = (props: PlaceInputProps) => {
  const [inputText, setInputText] = createSignal(props.value?.label ?? "");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const [isOpen, setIsOpen] = createSignal(false);

  createEffect(() => {
    const selected = props.value;
    setInputText(selected ? selected.label : "");
  });

  createEffect(() => {
    const query = inputText().trim();
    if (!isOpen() || query.length < 2) {
      setDebouncedQuery("");
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 240);
    onCleanup(() => clearTimeout(timer));
  });

  const suggestionsQuery = createQuery(() => ({
    queryKey: ["geocode", debouncedQuery()],
    queryFn: () => searchPlaces({ data: { query: debouncedQuery() } }),
    enabled: debouncedQuery().length >= 2 && isOpen(),
    staleTime: 5 * 60_000,
  }));

  const handleSelect = (place: PlaceSuggestion) => {
    setInputText(place.label);
    setIsOpen(false);
    props.onSelect(place);
  };

  return (
    <div class="relative">
      <div class="group flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2 transition-colors focus-within:border-sky-500/70 focus-within:bg-slate-900">
        <Show
          when={props.badgeText}
          fallback={<span class={`h-2.5 w-2.5 shrink-0 rounded-full ${props.dotColorClass}`} />}
        >
          {(badge) => (
            <span
              class={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${props.dotColorClass}`}
            >
              {badge()}
            </span>
          )}
        </Show>
        <div class="min-w-0 flex-1">
          <div class="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            {props.label}
          </div>
          <input
            type="text"
            value={inputText()}
            placeholder={props.placeholder}
            aria-label={props.label}
            onFocus={() => setIsOpen(true)}
            onBlur={() => {
              setTimeout(() => setIsOpen(false), 160);
            }}
            onInput={(event) => {
              setInputText(event.currentTarget.value);
              setIsOpen(true);
            }}
            class="w-full bg-transparent text-sm font-medium text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </div>
        <Show when={suggestionsQuery.isFetching}>
          <Loader2 class="h-4 w-4 shrink-0 animate-spin text-sky-400" />
        </Show>
        <Show when={inputText().length > 0 && !suggestionsQuery.isFetching}>
          <button
            type="button"
            aria-label="Effacer"
            onClick={() => {
              setInputText("");
              setDebouncedQuery("");
              props.onClear?.();
              setIsOpen(true);
            }}
            class="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </Show>
      </div>

      <Show when={isOpen() && suggestionsQuery.isSuccess && suggestionsQuery.data.length > 0}>
        <ul class="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-slate-700/80 bg-slate-900/98 p-1 shadow-2xl backdrop-blur-xl">
          <For each={suggestionsQuery.isSuccess ? suggestionsQuery.data : []}>
            {(place) => (
              <li>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    handleSelect(place);
                  }}
                  class="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-slate-800/90"
                >
                  <MapPin class="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium text-slate-100">{place.label}</div>
                    <div class="truncate text-xs text-slate-400">{place.subtitle}</div>
                  </div>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};
