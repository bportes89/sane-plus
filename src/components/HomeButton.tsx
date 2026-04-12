"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const publicRootRoutes = ["/login", "/onboarding", "/privacy", "/terms", "/splash"];

export function HomeButton({ className }: { className?: string }) {
  const pathname = usePathname();

  if (!pathname || pathname === "/" || pathname === "/home") {
    return null;
  }

  const href = publicRootRoutes.some((route) => pathname.startsWith(route)) ? "/" : "/home";

  return (
    <Link
      href={href}
      className={cn(
        "fixed left-4 top-4 z-50 inline-flex h-11 items-center gap-2 rounded-full border border-black/10 bg-white/96 px-4 font-title text-sm font-semibold text-primary shadow-lg backdrop-blur transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 dark:border-white/10 dark:bg-surface dark:text-foreground",
        className,
      )}
      aria-label="Ir para a home"
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5.25 9.75V21h13.5V9.75" />
      </svg>
      <span>Home</span>
    </Link>
  );
}
