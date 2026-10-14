import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import { panelLabelClassName } from "./typography";

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 rounded-md border border-surface-hover bg-surface px-5 py-4 max-[700px]:px-4", className)} {...props} />;
}

export function PanelTitle({ children, className, hint }: { children: ReactNode; className?: string; hint?: ReactNode }) {
  return (
    <div className={cn("mb-3.5", panelLabelClassName, className)}>
      {children}
      {hint ? <span className="text-xs font-normal tracking-normal normal-case"> {hint}</span> : null}
    </div>
  );
}

export function TwoColumnGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 grid grid-cols-1 gap-4 min-[701px]:grid-cols-2", className)} {...props} />;
}
