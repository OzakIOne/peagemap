import { Info } from "lucide-solid";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";

interface InfoTooltipProps {
  text: string;
  label: string;
}

export const InfoTooltip = (props: InfoTooltipProps) => {
  let triggerRef: HTMLButtonElement | undefined;
  const [open, setOpen] = createSignal(false);
  const [coords, setCoords] = createSignal({ top: 0, left: 0 });

  const updatePosition = () => {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const tooltipWidth = 256;
    const margin = 12;
    const rawLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
    const clampedLeft = Math.max(
      margin,
      Math.min(rawLeft, window.innerWidth - tooltipWidth - margin),
    );
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < 110 ? Math.max(margin, rect.top - 96) : rect.bottom + 8;
    setCoords({ top, left: clampedLeft });
  };

  const openTooltip = () => {
    updatePosition();
    setOpen(true);
  };

  createEffect(() => {
    if (!open()) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const handleOutside = (event: MouseEvent) => {
      if (triggerRef && !triggerRef.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleScroll = () => setOpen(false);

    window.addEventListener("keydown", handleKey);
    window.addEventListener("pointerdown", handleOutside);
    window.addEventListener("scroll", handleScroll, true);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("pointerdown", handleOutside);
      window.removeEventListener("scroll", handleScroll, true);
    });
  });

  return (
    <span class="inline-flex items-center">
      <button
        ref={(el) => {
          triggerRef = el;
        }}
        type="button"
        aria-label={props.label}
        aria-expanded={open()}
        onMouseEnter={openTooltip}
        onMouseLeave={() => setOpen(false)}
        onFocus={openTooltip}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          event.stopPropagation();
          if (open()) {
            setOpen(false);
          } else {
            openTooltip();
          }
        }}
        class="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-[background-color,color] duration-150 hover:bg-slate-800 hover:text-slate-100 focus-visible:bg-slate-800 focus-visible:text-slate-100"
      >
        <Info class="h-3.5 w-3.5" />
      </button>

      <Show when={open()}>
        <Portal>
          <div
            role="tooltip"
            style={{
              top: `${coords().top}px`,
              left: `${coords().left}px`,
              width: "256px",
            }}
            class="popover-enter pointer-events-none fixed z-[100] rounded-xl border border-slate-700/90 bg-slate-950/98 px-3 py-2 text-[11px] font-normal leading-relaxed text-slate-200 shadow-2xl backdrop-blur-xl"
          >
            {props.text}
          </div>
        </Portal>
      </Show>
    </span>
  );
};
