import type React from "react";
import { cn } from "@/lib/cn";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-xl border border-black/10 bg-white px-4 text-base outline-none ring-offset-2 transition focus-visible:ring-2 focus-visible:ring-secondary",
        className,
      )}
      {...props}
    />
  );
}
