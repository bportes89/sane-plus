"use client";

import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import Link from "next/link";
import { Button } from "@/components/Button";
import Image from "next/image";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type MeDto = {
  id: string;
  role: "CITIZEN" | "COMPANY" | "MODERATOR" | "LEGAL" | "ADMIN";
  name?: string | null;
};

export default function LandingPage() {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const [showcaseIndex, setShowcaseIndex] = useState(0);
  const [persona, setPersona] = useState<"citizen" | "company" | "city">("citizen");
  const [isScrolled, setIsScrolled] = useState(false);
  const { data: me } = useSWR<MeDto>("/api/auth/me", fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const systemHref = (() => {
    if (!me) return "/login";
    if (me.role === "COMPANY") return "/company";
    if (me.role === "MODERATOR" || me.role === "LEGAL" || me.role === "ADMIN") return "/support/admin";
    return "/home";
  })();

  const loginHref = me ? systemHref : "/login";
  const registerComplaintHref = me ? "/complaints/new" : "/login?next=%2Fcomplaints%2Fnew";
  const followComplaintsHref = me ? "/complaints" : "/login?next=%2Fcomplaints";

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      el.style.setProperty("--x", `${x}%`);
      el.style.setProperty("--y", `${y}%`);
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 14);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => {
      setShowcaseIndex((s) => (s + 1) % 3);
    }, 5200);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="min-h-dvh bg-background">
      <main className="p-0">
        <section className="w-full">
          <div ref={heroRef} className="relative overflow-hidden rounded-none aurora-gradient">
            <Image
              src="https://images.unsplash.com/photo-1521295121783-8a321d551ad2?q=80&w=1920&auto=format&fit=crop"
              alt=""
              fill
              priority
              sizes="100vw"
              className="absolute inset-0 object-cover opacity-80 mix-blend-soft-light"
            />
            <div className="absolute inset-0 bg-animated-hero" />
            <div className="absolute inset-0 opacity-90 bg-[radial-gradient(circle_at_14%_18%,rgba(255,255,255,0.35),transparent_46%),radial-gradient(circle_at_82%_30%,rgba(255,255,255,0.22),transparent_45%),radial-gradient(circle_at_50%_90%,rgba(255,255,255,0.12),transparent_55%)]" />
            <div className="absolute inset-0 grain opacity-40 mix-blend-overlay pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.35))]" />

            <header
              className={[
                "fixed left-0 right-0 top-0 z-50 transition-all",
                isScrolled ? "bg-black/25 backdrop-blur-xl border-b border-white/10" : "bg-transparent",
              ].join(" ")}
            >
              <div className="px-6 py-4">
                <div className="mx-auto max-w-6xl flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Logo href="/" />
                    <div className="hidden sm:block text-white/85 text-sm">
                      Sua voz por um saneamento melhor.
                    </div>
                  </div>
                  <nav className="hidden md:flex items-center gap-6 text-sm text-white/80">
                    <a href="#como-funciona" className="hover:text-white transition-colors">
                      Como funciona
                    </a>
                    <a href="#mapa" className="hover:text-white transition-colors">
                      Mapa
                    </a>
                    <a href="#para-empresas" className="hover:text-white transition-colors">
                      Empresas
                    </a>
                    <a href="#faq" className="hover:text-white transition-colors">
                      FAQ
                    </a>
                    <Link href="/ranking" className="hover:text-white transition-colors">
                      Ranking
                    </Link>
                    <Link href="/heatmap" className="hover:text-white transition-colors">
                      Mapa de calor
                    </Link>
                  </nav>
                  <div className="flex items-center gap-2">
                    <Link href={loginHref} className="inline-flex">
                      <Button variant="secondary" className="rounded-2xl btn-glow">
                        {me ? "Acessar sistema" : "Entrar"}
                      </Button>
                    </Link>
                    <Link href="/onboarding" className="inline-flex">
                      <Button className="rounded-2xl btn-glow">Começar</Button>
                    </Link>
                  </div>
                </div>
              </div>
            </header>

            <div className="relative w-full px-6 pt-24 pb-14 sm:pt-28 sm:pb-16">
              <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
                <div className="lg:col-span-6 text-white">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs text-white/85">
                    <span className="inline-block h-2 w-2 rounded-full bg-white/80" />
                    MVP funcional • Reclamação → resposta → acompanhamento → finalização
                  </div>
                  <h1 className="mt-6 text-gradient font-title font-bold text-4xl sm:text-6xl leading-[1.04] neon-heading">
                    SANE+ transforma reclamações em dados, apoio e solução.
                  </h1>
                  <div className="mt-5 text-white/85 text-sm sm:text-base leading-7 max-w-xl">
                    Uma plataforma estilo “Reclame Aqui”, focada em saneamento: fluxo completo, moderação, reputação das empresas e possibilidade de georreferenciamento.
                  </div>

                  <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
                    {[
                      "Registro simples e rastreável",
                      "Resposta da empresa + timeline",
                      "Privacidade (LGPD) e moderação",
                      "Mapa e indicadores públicos",
                    ].map((t) => (
                      <div key={t} className="flex items-start gap-2 rounded-2xl bg-white/10 border border-white/15 px-4 py-3">
                        <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-xl bg-white/15 border border-white/15">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        </span>
                        <div className="text-sm text-white/90 leading-6">{t}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-7">
                    <CTAButtons
                      registerComplaintHref={registerComplaintHref}
                      followComplaintsHref={followComplaintsHref}
                    />
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-white/80">
                      <a href="#como-funciona" className="inline-flex items-center gap-2 hover:text-white transition-colors">
                        Ver fluxo completo
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-white/10">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 5v14" />
                            <path d="m19 12-7 7-7-7" />
                          </svg>
                        </span>
                      </a>
                      <Link href="/ranking" className="hover:text-white transition-colors">
                        Ver ranking das empresas
                      </Link>
                      <Link href="/heatmap" className="hover:text-white transition-colors">
                        Explorar mapa de calor
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-6 tilt">
                  <div className="tilt-inner relative rounded-3xl overflow-hidden border border-white/20 glass glow-border">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(255,255,255,0.20),transparent_55%)]" />
                    <div className="absolute inset-x-0 top-0 h-16 bg-[linear-gradient(180deg,rgba(255,255,255,0.10),transparent)]" />

                    <div className="relative p-5 sm:p-6">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-white">
                          <div className="font-title font-bold text-lg">Demo SANE+</div>
                          <div className="text-xs text-white/80 mt-0.5">Escolha a visão: cidadão, empresa ou gestão pública.</div>
                        </div>
                        <div className="inline-flex rounded-2xl border border-white/15 bg-white/10 p-1">
                          <PersonaButton active={persona === "citizen"} onClick={() => setPersona("citizen")}>
                            Cidadão
                          </PersonaButton>
                          <PersonaButton active={persona === "company"} onClick={() => setPersona("company")}>
                            Empresa
                          </PersonaButton>
                          <PersonaButton active={persona === "city"} onClick={() => setPersona("city")}>
                            Prefeitura
                          </PersonaButton>
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <KpiCard
                          title={persona === "citizen" ? "Acompanhar status" : persona === "company" ? "Responder rápido" : "Ver hotspots"}
                          value={persona === "citizen" ? "Timeline" : persona === "company" ? "SLA" : "Mapa"}
                          sub={persona === "citizen" ? "em um lugar só" : persona === "company" ? "tempo médio" : "por bairro"}
                        />
                        <KpiCard
                          title={persona === "citizen" ? "Privacidade" : persona === "company" ? "Reputação" : "Indicadores"}
                          value={persona === "citizen" ? "LGPD" : persona === "company" ? "Índice" : "SANE+"}
                          sub={persona === "citizen" ? "e moderação" : persona === "company" ? "e ranking" : "público"}
                        />
                      </div>

                      <div className="mt-4 rounded-2xl border border-white/15 bg-white/10 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                          <div className="text-white font-title font-semibold text-sm">
                            {persona === "citizen"
                              ? "Registrar reclamação"
                              : persona === "company"
                                ? "Painel da empresa"
                                : "Painel de gestão"}
                          </div>
                          <div className="text-xs text-white/75">
                            {persona === "citizen"
                              ? "3 passos • CEP → mapa"
                              : persona === "company"
                                ? "respostas • exportação"
                                : "alertas • relatórios"}
                          </div>
                        </div>
                        <div className="p-4">
                          <div className="relative aspect-[16/9] rounded-xl overflow-hidden border border-white/10">
                            <Image
                              src={[
                                "/consumidores-usuarios.jpg",
                                "/prognostico-planejamento.jpg",
                                "/consumidores-mesa.jpg",
                              ][showcaseIndex]}
                              alt="Prévia do produto"
                              fill
                              sizes="(max-width: 1024px) 100vw, 520px"
                              className="object-cover opacity-75"
                            />
                            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.15),rgba(0,0,0,0.40))]" />
                            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3">
                              <div className="text-xs text-white/85">
                                {persona === "citizen"
                                  ? "Status: PUBLICADA • Local: georreferenciado"
                                  : persona === "company"
                                    ? "SLA: 3h • Taxa solução: 87%"
                                    : "Hotspot: alta incidência • últimos 30 dias"}
                              </div>
                              <div className="flex items-center gap-2">
                                {[0, 1, 2].map((i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    aria-label={`Selecionar preview ${i + 1}`}
                                    onClick={() => setShowcaseIndex(i)}
                                    className={[
                                      "h-2.5 w-2.5 rounded-full border border-white/60",
                                      i === showcaseIndex ? "bg-white" : "bg-white/20",
                                    ].join(" ")}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {[
                              persona === "citizen" ? "Registrar" : persona === "company" ? "Responder" : "Monitorar",
                              persona === "citizen" ? "Acompanhar" : persona === "company" ? "Métricas" : "Alertas",
                              persona === "citizen" ? "Resolver" : persona === "company" ? "Exportar" : "Relatórios",
                            ].map((s) => (
                              <div key={s} className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs text-white/85 flex items-center justify-between">
                                <span className="font-title font-semibold">{s}</span>
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10 border border-white/10">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M13 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
                                    <path d="M21 3 9 15" />
                                    <path d="M15 3h6v6" />
                                  </svg>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mx-auto max-w-6xl mt-12 flex flex-wrap items-center justify-center gap-2 text-xs text-white/75">
                {[
                  "Saneamento",
                  "Dados públicos",
                  "Reputação",
                  "Moderação",
                  "LGPD",
                  "Georreferenciamento",
                ].map((t) => (
                  <span key={t} className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-4 py-2">
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <ParticleLayer />

            <svg
              className="absolute bottom-0 left-0 right-0 pointer-events-none h-16 sm:h-20 opacity-90"
              viewBox="0 0 1440 180"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d="M0,120 C220,170 420,120 720,150 C1040,182 1210,120 1440,140 L1440,180 L0,180 Z"
                fill="rgba(255,255,255,0.18)"
              />
              <path
                d="M0,140 C260,120 440,170 720,132 C980,92 1200,120 1440,92 L1440,180 L0,180 Z"
                fill="rgba(255,255,255,0.12)"
              />
            </svg>
          </div>
        </section>

        <section id="como-funciona" className="w-full">
          <div className="relative overflow-hidden rounded-none">
            <div className="relative w-full px-6 py-14 sm:py-16">
              <div className="mx-auto max-w-6xl">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                  <div className="lg:col-span-4">
                    <div className="font-title font-bold text-2xl sm:text-3xl">
                      Fluxo completo, do início ao “resolvido”.
                    </div>
                    <div className="mt-3 text-sm text-foreground/75 leading-7">
                      Tudo pensado para ser direto, rastreável e útil para cidadãos, empresas e gestão pública.
                    </div>
                    <div className="mt-6 flex flex-wrap gap-2">
                      <Link href={registerComplaintHref} className="inline-flex">
                        <Button className="rounded-2xl btn-glow">Registrar agora</Button>
                      </Link>
                      <Link href={loginHref} className="inline-flex">
                        <Button variant="secondary" className="rounded-2xl btn-glow">Entrar</Button>
                      </Link>
                    </div>
                  </div>

                  <div className="lg:col-span-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <StepCard
                        n="01"
                        title="Registro"
                        text="Escolha empresa, categoria, localização (CEP + mapa), descrição e anexos."
                        tone="primary"
                      />
                      <StepCard
                        n="02"
                        title="Resposta"
                        text="A empresa responde com histórico, anexos e atualização de status."
                        tone="secondary"
                      />
                      <StepCard
                        n="03"
                        title="Acompanhamento"
                        text="Linha do tempo, notificações e possibilidade de contestação."
                        tone="accent"
                      />
                      <StepCard
                        n="04"
                        title="Finalização"
                        text="Marcar como resolvido (com pontos/selos) e compor reputação da empresa."
                        tone="highlight"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: "Tempo médio de resposta", value: "3h", sub: "beta" },
                    { label: "Taxa de solução", value: "87%", sub: "últimos 30 dias" },
                    { label: "Reclamações ativas", value: "1.204", sub: "em acompanhamento" },
                    { label: "Índice SANE+", value: "A-", sub: "responsividade" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-2xl glass-light glow-border px-5 py-6">
                      <div className="text-sm text-foreground/70">{s.label}</div>
                      <div className="mt-2 font-title font-bold text-2xl">{s.value}</div>
                      <div className="text-xs text-foreground/60 mt-1">{s.sub}</div>
                      <div className="mt-3 h-1.5 rounded-full shimmer" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="mapa" className="w-full">
          <div className="relative overflow-hidden rounded-none grid-bg">
            <div className="relative w-full px-6 py-14 sm:py-16">
              <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
                <div className="lg:col-span-6">
                  <div className="font-title font-bold text-2xl sm:text-3xl">
                    Georreferenciamento que vira visão de cidade.
                  </div>
                  <div className="mt-3 text-sm text-foreground/75 leading-7">
                    Localização por CEP + ajuste no mapa. Para público, é transparência. Para gestão, é priorização.
                  </div>
                  <div className="mt-6 space-y-3">
                    {[
                      "Mapa de reclamações (com privacidade quando necessário)",
                      "Hotspots por bairro e categoria",
                      "Evidências por fotos/anexos",
                      "Base pronta para integrações com prefeituras",
                    ].map((t) => (
                      <div key={t} className="flex items-start gap-2 rounded-2xl bg-black/5 border border-black/5 px-4 py-3">
                        <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5c-1.4 0-2.5-1.1-2.5-2.5S10.6 6.5 12 6.5s2.5 1.1 2.5 2.5S13.4 11.5 12 11.5z"/>
                          </svg>
                        </span>
                        <div className="text-sm text-foreground/80 leading-6">{t}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-7 flex flex-wrap gap-2">
                    <Link href={followComplaintsHref} className="inline-flex">
                      <Button className="rounded-2xl btn-glow">Ver minhas reclamações</Button>
                    </Link>
                    <Link href="/ranking" className="inline-flex">
                      <Button variant="secondary" className="rounded-2xl btn-glow">Ver ranking</Button>
                    </Link>
                  </div>
                </div>

                <div className="lg:col-span-6 tilt">
                  <div className="tilt-inner relative rounded-3xl overflow-hidden border border-black/10 bg-white shadow-[0_26px_70px_rgba(31,111,179,0.18)]">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(130,10,209,0.12),transparent_55%),radial-gradient(circle_at_90%_10%,rgba(31,111,179,0.12),transparent_55%),radial-gradient(circle_at_50%_110%,rgba(34,193,168,0.12),transparent_55%)]" />
                    <div className="relative p-5 sm:p-6">
                      <div className="flex items-center justify-between">
                        <div className="font-title font-bold text-lg">Mapa de ocorrências</div>
                        <div className="text-xs text-foreground/60">público • moderado</div>
                      </div>
                      <div className="mt-4 relative aspect-[16/10] rounded-2xl overflow-hidden border border-black/10">
                        <Image
                          src="/prognostico-planejamento.jpg"
                          alt="Exemplo de visão georreferenciada"
                          fill
                          sizes="(max-width: 1024px) 100vw, 520px"
                          className="object-cover"
                        />
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.35))]" />
                        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3">
                          <div className="text-xs text-white/90">
                            Filtros por cidade, status e categoria
                          </div>
                          <div className="inline-flex items-center gap-1 rounded-full bg-white/20 border border-white/25 px-3 py-1 text-xs text-white/90">
                            <span className="inline-block h-2 w-2 rounded-full bg-white/85" />
                            heatmap
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        {[
                          { label: "Água", tone: "bg-primary/10 text-primary" },
                          { label: "Esgoto", tone: "bg-highlight/10 text-highlight" },
                          { label: "Infra", tone: "bg-secondary/15 text-primary" },
                        ].map((x) => (
                          <div key={x.label} className={`rounded-xl border border-black/10 bg-white px-3 py-2 text-xs flex items-center justify-between ${x.tone}`}>
                            <span className="font-title font-semibold">{x.label}</span>
                            <span className="text-[11px] opacity-80">filtro</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="para-empresas" className="w-full">
          <div className="relative overflow-hidden rounded-none">
            <div className="absolute inset-0 bg-animated-panel" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_0%,rgba(255,255,255,0.35),transparent_55%)]" />
            <div className="relative w-full px-6 py-14 sm:py-16">
              <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                <div className="lg:col-span-5">
                  <div className="font-title font-bold text-2xl sm:text-3xl text-primary">
                    Um painel de empresa que incentiva resposta e solução.
                  </div>
                  <div className="mt-3 text-sm text-foreground/80 leading-7">
                    Reputação, SLA, exportação e evidências. Menos ruído. Mais resolução.
                  </div>
                  <div className="mt-7 flex flex-wrap gap-2">
                    <Link href={loginHref} className="inline-flex">
                      <Button className="rounded-2xl btn-glow">Entrar como empresa</Button>
                    </Link>
                    <Link href="/ranking" className="inline-flex">
                      <Button variant="secondary" className="rounded-2xl btn-glow">Ver reputação</Button>
                    </Link>
                  </div>
                </div>

                <div className="lg:col-span-7">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FeatureCard
                      title="Tempo médio de resposta"
                      text="Indicadores e ranking estimulam resposta rápida."
                      icon="timer"
                    />
                    <FeatureCard
                      title="Taxa de solução"
                      text="Resumo de casos resolvidos, em aberto e contestados."
                      icon="check"
                    />
                    <FeatureCard
                      title="Exportação e relatórios"
                      text="Dados prontos para auditoria interna e gestão."
                      icon="download"
                    />
                    <FeatureCard
                      title="Moderação e jurídico"
                      text="Camadas de segurança para conteúdo sensível."
                      icon="shield"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="w-full">
          <div className="relative overflow-hidden rounded-none">
            <div className="relative w-full px-6 py-14 sm:py-16">
              <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                <div className="lg:col-span-4">
                  <div className="font-title font-bold text-2xl sm:text-3xl">
                    Perguntas rápidas
                  </div>
                  <div className="mt-3 text-sm text-foreground/75 leading-7">
                    Direto ao ponto: privacidade, moderação e como entrar no sistema.
                  </div>
                </div>
                <div className="lg:col-span-8 space-y-3">
                  <FaqItem
                    q="Como eu entro no sistema pela landing?"
                    a="Use o botão “Entrar/Acessar sistema” no topo. Se você estiver logado, ele já te leva direto para a área correta (cidadão, empresa ou suporte)."
                  />
                  <FaqItem
                    q="Tem mapa e localização?"
                    a="Sim. No registro você pode usar CEP para preencher endereço e definir a localização no mapa. A plataforma também suporta visão agregada para transparência e planejamento."
                  />
                  <FaqItem
                    q="Como funciona a privacidade e LGPD?"
                    a="A plataforma aplica moderação e controles de visibilidade. Conteúdo sensível pode ser ajustado/ocultado e o mapa pode usar anonimização quando necessário."
                  />
                  <FaqItem
                    q="O que a empresa ganha?"
                    a="Visibilidade + métricas. Quanto mais rápida e efetiva for a resposta, melhor a reputação (índice, taxa de solução, tempo médio) e menos escalonamentos."
                  />
                </div>
              </div>

              <div className="mx-auto max-w-6xl mt-12 rounded-3xl overflow-hidden border border-black/10 bg-white shadow-[0_26px_70px_rgba(130,10,209,0.12)]">
                <div className="p-6 sm:p-8 relative">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_15%,rgba(130,10,209,0.10),transparent_55%),radial-gradient(circle_at_90%_10%,rgba(31,111,179,0.10),transparent_55%),radial-gradient(circle_at_50%_120%,rgba(34,193,168,0.10),transparent_60%)]" />
                  <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                    <div className="lg:col-span-8">
                      <div className="font-title font-bold text-2xl">
                        Pronto para testar o SANE+ agora?
                      </div>
                      <div className="mt-2 text-sm text-foreground/75 leading-7">
                        Entre no sistema e registre sua primeira reclamação. Se preferir, comece pelo onboarding.
                      </div>
                    </div>
                    <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-2 justify-end">
                      <Link href={loginHref} className="inline-flex">
                        <Button className="w-full rounded-2xl btn-glow">{me ? "Acessar sistema" : "Entrar"}</Button>
                      </Link>
                      <Link href="/onboarding" className="inline-flex">
                        <Button variant="secondary" className="w-full rounded-2xl btn-glow">Começar</Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <footer className="w-full px-6 py-10">
          <div className="mx-auto max-w-6xl flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="text-sm text-foreground/70">
              © {new Date().getFullYear()} SANE+ — Sua voz por um saneamento melhor.
            </div>
            <div className="text-sm text-foreground/70">
              contato@saneplus.com.br
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

function ParticleLayer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const particles = Array.from({ length: 36 }).map(() => ({
      x: Math.random() * c.width,
      y: Math.random() * c.height,
      r: 1.2 + Math.random() * 1.6,
      dx: -0.2 + Math.random() * 0.4,
      dy: -0.2 + Math.random() * 0.4,
      a: 0.4 + Math.random() * 0.6,
    }));
    const render = () => {
      const { width, height } = c;
      ctx.clearRect(0, 0, width, height);
      particles.forEach((p) => {
        p.x += p.dx;
        p.y += p.dy;
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${p.a})`;
        ctx.fill();
      });
      raf = requestAnimationFrame(render);
    };
    const onResize = () => {
      c.width = c.clientWidth;
      c.height = c.clientHeight;
    };
    onResize();
    render();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0"
      style={{ opacity: 0.5 }}
    />
  );
}

function PersonaButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-3 h-9 rounded-2xl font-title font-semibold text-xs transition-colors",
        active ? "bg-white text-black" : "text-white/85 hover:text-white hover:bg-white/10",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function KpiCard({
  title,
  value,
  sub,
}: {
  title: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-4">
      <div className="text-xs text-white/80">{title}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="font-title font-bold text-white text-2xl leading-none">{value}</div>
        <div className="text-[11px] text-white/70">{sub}</div>
      </div>
      <div className="mt-3 h-1.5 rounded-full shimmer" />
    </div>
  );
}

function StepCard({
  n,
  title,
  text,
  tone,
}: {
  n: string;
  title: string;
  text: string;
  tone: "primary" | "secondary" | "accent" | "highlight";
}) {
  const toneClass =
    tone === "primary"
      ? "from-primary/20 to-primary/5"
      : tone === "secondary"
        ? "from-secondary/25 to-secondary/10"
        : tone === "accent"
          ? "from-accent/25 to-accent/10"
          : "from-highlight/20 to-highlight/10";
  return (
    <div className="rounded-3xl overflow-hidden border border-black/10 bg-white shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
      <div className={`h-1.5 bg-[linear-gradient(90deg,var(--tw-gradient-stops))] ${toneClass}`} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-title font-bold text-lg">{title}</div>
            <div className="mt-2 text-sm text-foreground/75 leading-7">{text}</div>
          </div>
          <div className="font-title font-bold text-sm text-foreground/50">{n}</div>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  title,
  text,
  icon,
}: {
  title: string;
  text: string;
  icon: "timer" | "check" | "download" | "shield";
}) {
  const iconSvg =
    icon === "timer" ? (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 2h4" />
        <path d="M12 14v-4" />
        <path d="M12 14l3 2" />
        <circle cx="12" cy="14" r="8" />
      </svg>
    ) : icon === "check" ? (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    ) : icon === "download" ? (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5 5 5-5" />
        <path d="M12 15V3" />
      </svg>
    ) : (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    );

  return (
    <div className="rounded-3xl bg-white/70 border border-black/10 shadow-[0_18px_50px_rgba(31,111,179,0.10)] p-5 backdrop-blur">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          {iconSvg}
        </span>
        <div>
          <div className="font-title font-semibold">{title}</div>
          <div className="mt-1 text-sm text-foreground/75 leading-7">{text}</div>
        </div>
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-2xl border border-black/10 bg-white p-5 shadow-[0_18px_50px_rgba(0,0,0,0.05)]">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
        <div className="font-title font-semibold">{q}</div>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-muted text-foreground/70 transition-transform group-open:rotate-45">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </span>
      </summary>
      <div className="mt-3 text-sm text-foreground/75 leading-7">{a}</div>
    </details>
  );
}

function CTAButtons({
  registerComplaintHref,
  followComplaintsHref,
}: {
  registerComplaintHref: string;
  followComplaintsHref: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const buttons = Array.from(el.querySelectorAll("a > button"));
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left - r.width / 2;
      const y = e.clientY - r.top - r.height / 2;
      buttons.forEach((b, i) => {
        const k = i === 0 ? 1 : 0.8;
        (b as HTMLButtonElement).style.transform = `translate(${x * 0.02 * k}px, ${y * 0.02 * k}px)`;
      });
    };
    const onLeave = () => {
      buttons.forEach((b) => ((b as HTMLButtonElement).style.transform = "translate(0,0)"));
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, []);
  return (
    <div ref={ref} className="mt-6 flex flex-col sm:flex-row gap-3">
      <Link href={registerComplaintHref} prefetch={false} className="inline-flex">
        <Button className="w-full sm:w-auto rounded-2xl btn-glow">Registrar reclamação</Button>
      </Link>
      <Link href={followComplaintsHref} className="inline-flex">
        <Button variant="secondary" className="w-full sm:w-auto rounded-2xl btn-glow">Acompanhar</Button>
      </Link>
    </div>
  );
}
