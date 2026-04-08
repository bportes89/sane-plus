import { cn } from "@/lib/cn";
import type React from "react";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white text-foreground border border-black/5 shadow-sm dark:bg-surface dark:border-white/10",
        className,
      )}
      {...props}
    />
  );
}
