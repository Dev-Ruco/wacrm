"use client";

import { cn } from "@/lib/utils";

export interface SegmentedControlItem {
  value: string;
  label: string;
  badge?: React.ReactNode;
}

/**
 * A horizontal, pill-style sub-navigation control — the module-level
 * "second nav" (Visão geral / Comportamento / Ferramentas / …) that
 * belongs *inside* a module's single content area, not as a second
 * sidebar next to the app's one contextual submenu. Scrolls
 * horizontally on narrow viewports instead of wrapping or being
 * squeezed.
 */
export function SegmentedControl({
  items,
  value,
  onChange,
  className,
}: {
  items: SegmentedControlItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {items.map((item) => {
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.value)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
              isActive
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}
