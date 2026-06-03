import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

/** Consistent empty / zero-data panels across workstation screens. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-10 gap-3",
        className,
      )}
    >
      {icon && (
        <div className="text-muted-foreground/60 [&_svg]:w-8 [&_svg]:h-8">
          {icon}
        </div>
      )}
      <p className="font-mono text-sm text-foreground/90">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground max-w-md leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
