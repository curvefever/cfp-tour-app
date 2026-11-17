import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 rounded-md border border-surface-hover bg-surface px-5 py-4 max-[700px]:px-4", className)} {...props} />;
}
