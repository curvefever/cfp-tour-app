import type { HTMLAttributes } from "react";
import { cn } from "./cn";

type BadgeTone = "success" | "danger" | "neutral" | "primary" | "accent" | "warning" | "now";
// Tinted pills as on the boards: a translucent ground of the colour with a lighter text of the same hue.
const tones: Record<BadgeTone, string> = {
  success: "bg-success/16 text-cfp-green-text",
  danger: "bg-danger/18 text-cfp-danger-text",
  neutral: "bg-foreground/12 text-foreground",
  primary: "bg-primary/16 text-cfp-sky",
  accent: "bg-accent/18 text-cfp-purple-text",
  warning: "bg-warning/18 text-cfp-orange-text",
  now: "bg-cfp-violet text-white",
};

export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cn("inline-block whitespace-nowrap rounded px-2 py-1 text-[11px] leading-none font-extrabold tracking-[0.05em] uppercase", tones[tone], className)} {...props} />;
}
