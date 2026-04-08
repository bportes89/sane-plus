import { cn } from "@/lib/cn";
import type React from "react";

export function Button({
  variant = "primary",
  size = "md",
  className,
  type,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2",
        variant === "primary" &&
          "bg-accent text-white hover:bg-highlight active:bg-primary",
        variant === "secondary" &&
          "bg-white text-primary border border-black/10 hover:bg-muted",
        variant === "ghost" && "bg-transparent text-primary hover:bg-muted",
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-11 px-4 text-base",
        size === "lg" && "h-12 px-5 text-base",
        className,
      )}
      type={type ?? "button"}
      {...props}
    />
  );
}
