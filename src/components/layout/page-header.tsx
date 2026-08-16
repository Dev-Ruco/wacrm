import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one page-title treatment every module page should use — see
 * `.text-page-title` in globals.css. Replaces the ~4 slightly
 * different `<h1>` classNames that had accumulated across pages
 * before the 2026 redesign.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="text-label mb-1">{eyebrow}</div> : null}
        <h1 className="text-page-title">{title}</h1>
        {description ? <p className="text-body mt-1 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
