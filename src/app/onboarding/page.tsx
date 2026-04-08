"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const slides = useMemo(
    () => [
      {
        title: "Transparência para melhorar o saneamento.",
        text: "Acompanhe sua reclamação do início ao fim, com status e histórico claros.",
        icon: (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16v16H4z" />
            <path d="M8 16V8" />
            <path d="M12 16V11" />
            <path d="M16 16V6" />
          </svg>
        ),
      },
      {
        title: "Reclamar ficou simples.",
        text: "Escolha a empresa, descreva o problema, marque o local e acompanhe a solução.",
        icon: (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" />
          </svg>
        ),
      },
      {
        title: "Sua privacidade é prioridade.",
        text: "Seus dados são protegidos e o conteúdo passa por regras de moderação.",
        icon: (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        ),
      },
    ],
    [],
  );

  const [index, setIndex] = useState(() => {
    const raw = searchParams.get("step");
    const n = Number(raw ?? "1");
    if (!Number.isFinite(n)) return 0;
    const i = Math.trunc(n) - 1;
    if (i < 0) return 0;
    if (i >= slides.length) return slides.length - 1;
    return i;
  });
  const slide = slides[index];

  return (
    <div className="min-h-dvh flex flex-col bg-primary">
      <header className="px-6 pt-8 flex items-center justify-between">
        <div className="text-white">
          <Logo href="/" />
        </div>
        <Link
          href="/login"
          className="text-white/80 text-sm hover:text-white transition"
          onClick={() => {
            localStorage.setItem("sane_onboarded", "1");
          }}
        >
          Pular
        </Link>
      </header>

      <main className="flex-1 px-6 flex items-center">
        <div className="w-full max-w-xl mx-auto">
          <div className="rounded-3xl bg-white/95 border border-white/25 px-6 py-8 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                {slide.icon}
              </span>
              <div className="text-sm text-foreground/70">
                {index + 1} de {slides.length}
              </div>
            </div>

            <h1 className="mt-5 font-title font-bold text-2xl text-foreground">
              {slide.title}
            </h1>
            <p className="mt-3 text-base text-foreground/80">{slide.text}</p>

            <div className="mt-8 flex items-center gap-2">
              {slides.map((_, i) => (
                <Link
                  key={i}
                  className={`h-2.5 rounded-full transition-all ${
                    i === index ? "w-10 bg-primary" : "w-2.5 bg-black/10"
                  }`}
                  href={`/onboarding?step=${i + 1}`}
                  onClick={() => setIndex(i)}
                  aria-label={`Ir para a tela ${i + 1}`}
                />
              ))}
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            {index === 0 ? (
              <span
                className="flex-1 inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-11 px-4 text-base bg-white text-primary border border-black/10 opacity-60 cursor-not-allowed"
                aria-disabled="true"
              >
                Voltar
              </span>
            ) : (
              <Link
                href={`/onboarding?step=${index}`}
                className="flex-1 inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-11 px-4 text-base bg-white text-primary border border-black/10 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2"
                onClick={() => setIndex((v) => Math.max(0, v - 1))}
              >
                Voltar
              </Link>
            )}

            <Link
              href={index < slides.length - 1 ? `/onboarding?step=${index + 2}` : "/login"}
              className="flex-1 inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-11 px-4 text-base bg-accent text-white hover:bg-highlight active:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2"
              onClick={() => {
                if (index < slides.length - 1) {
                  setIndex((v) => Math.min(slides.length - 1, v + 1));
                  return;
                }
                localStorage.setItem("sane_onboarded", "1");
                router.replace("/login");
              }}
            >
              {index < slides.length - 1 ? "Próximo" : "Começar"}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingInner />
    </Suspense>
  );
}
