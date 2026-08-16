import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string;
  icon: ComponentType<{ className?: string }>;
  delta?: {
    sign: number;
    label: string;
  };
  subtitle?: string;
}

/**
 * Dashboard KPIs belong to one information strip, not four unrelated cards.
 * The parent owns the shared border/surface; this component only renders the
 * metric's hierarchy.
 */
export function MetricCard({
  title,
  value,
  icon: Icon,
  delta,
  subtitle,
}: MetricCardProps) {
  return (
    <div className="min-w-0 bg-card px-4 py-4 sm:px-5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4 shrink-0" />
        <p className="truncate text-xs font-medium">{title}</p>
      </div>
      <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </p>
      {delta ? (
        <DeltaRow sign={delta.sign} label={delta.label} />
      ) : subtitle ? (
        <p className="text-muted-foreground mt-2 truncate text-xs">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

function DeltaRow({ sign, label }: { sign: number; label: string }) {
  const tone =
    sign > 0
      ? 'text-primary'
      : sign < 0
        ? 'text-destructive'
        : 'text-muted-foreground';
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus;
  return (
    <div className={cn('mt-2 flex items-center gap-1 text-xs', tone)}>
      <Arrow className="size-3.5" aria-hidden />
      <span className="truncate tabular-nums">{label}</span>
    </div>
  );
}
