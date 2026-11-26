import { createQuery } from "@tanstack/solid-query";
import { AlertCircle, Loader2, MapPin, X } from "lucide-solid";
import { For, Show, createEffect, createSignal, createUniqueId, onCleanup } from "solid-js";
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
  const listboxId = createUniqueId();
  const [inputText, setInputText] = createSignal(props.value?.label ?? "");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const [isOpen, setIsOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);

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
    }, 220);
    onCleanup(() => clearTimeout(timer));
  });

  const suggestionsQuery = createQuery(() => ({
    queryKey: ["geocode", debouncedQuery()],
    queryFn: () => searchPlaces({ data: { query: debouncedQuery() } }),
    enabled: debouncedQuery().length >= 2 && isOpen(),
    staleTime: 5 * 60_000,
    retry: 1,
  }));

  const suggestions = () => (suggestionsQuery.isSuccess ? suggestionsQuery.data : []);

  createEffect(() => {
    const list = suggestions();
    if (list.length > 0) {
      setActiveIndex(0);
    }
  });

  const handleSelect = (place: PlaceSuggestion) => {
    setInputText(place.label);
    setIsOpen(false);
    setActiveIndex(0);
    props.onSelect(place);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const list = suggestions();
    if (event.key === "Escape") {
      setIsOpen(false);
      setInputText(props.value?.label ?? "");
      return;
    }
    if (!isOpen() || list.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % list.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (prev - 1 + list.length) % list.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = list[activeIndex()] ?? list[0];
      if (chosen) handleSelect(chosen);
    }
  };

  const showDropdown = () =>
    isOpen() &&
    debouncedQuery().length >= 2 &&
    (suggestionsQuery.isSuccess || suggestionsQuery.isError);

  return (
    <div class="relative">
      <div class="group flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2 transition-[border-color,background-color] duration-150 focus-within:border-sky-500/70 focus-within:bg-slate-900">
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
            role="combobox"
            aria-expanded={showDropdown()}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-label={props.label}
            value={inputText()}
            placeholder={props.placeholder}
            onFocus={() => setIsOpen(true)}
            onBlur={() => {
              setTimeout(() => {
                setIsOpen(false);
                const selectedLabel = props.value?.label ?? "";
                if (inputText().trim() !== selectedLabel) {
                  setInputText(selectedLabel);
                }
              }, 160);
            }}
            onKeyDown={handleKeyDown}
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
            class="rounded-md p-1 text-slate-500 transition-[background-color,color] duration-150 hover:bg-slate-800 hover:text-slate-200 active:scale-95"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </Show>
      </div>

      <Show when={showDropdown()}>
        <div
          id={listboxId}
          role="listbox"
          class="popover-enter absolute left-0 right-0 top-full z-50 mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-slate-700/80 bg-slate-900/98 p-1 shadow-2xl backdrop-blur-xl"
        >
          <Show when={suggestionsQuery.isError}>
            <div class="flex items-center gap-2 px-2.5 py-2 text-xs text-rose-300">
              <AlertCircle class="h-3.5 w-3.5 shrink-0" />
              <span>Erreur de recherche. Réessayez dans un instant.</span>
            </div>
          </Show>

          <Show when={suggestionsQuery.isSuccess && suggestions().length === 0}>
            <div class="px-2.5 py-2 text-xs text-slate-400">
              Aucun lieu trouvé pour « {debouncedQuery()} »
            </div>
          </Show>

          <Show when={suggestions().length > 0}>
            <ul>
              <For each={suggestions()}>
                {(place, index) => (
                  <li role="option" aria-selected={activeIndex() === index()}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIndex(index())}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handleSelect(place);
                      }}
                      class={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-100 ${
                        activeIndex() === index() ? "bg-slate-800/95" : "hover:bg-slate-800/70"
                      }`}
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
      </Show>
    </div>
  );
};
