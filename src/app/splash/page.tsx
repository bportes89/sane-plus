"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SplashPage() {
  const router = useRouter();

  useEffect(() => {
    const t = window.setTimeout(() => {
      const onboarded = localStorage.getItem("sane_onboarded") === "1";
      router.replace(onboarded ? "/login" : "/onboarding");
    }, 900);
    return () => window.clearTimeout(t);
  }, [router]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-primary">
      <div className="px-6 text-center">
        <div className="font-title font-bold text-5xl tracking-tight text-white">
          SANE<span className="text-white/90">+</span>
        </div>
        <div className="mt-3 text-sm text-secondary">
          Sua voz por um saneamento melhor.
        </div>
      </div>
    </div>
  );
}
