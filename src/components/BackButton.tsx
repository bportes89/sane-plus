"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { cn } from "@/lib/cn";

export function BackButton({
  fallbackHref = "/home",
  className,
}: {
  fallbackHref?: string;
  className?: string;
}) {
  const router = useRouter();

  return (
    <Button
      variant="secondary"
      size="sm"
      className={cn(
        "h-11 w-11 p-0 rounded-full shadow-lg dark:bg-surface dark:text-foreground dark:border-white/10",
        className,
      )}
      aria-label="Voltar"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
          return;
        }
        router.replace(fallbackHref);
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </Button>
  );
}

