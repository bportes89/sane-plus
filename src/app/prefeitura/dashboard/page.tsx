import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { UserRole } from "@/generated/prisma/client";
import {
  computeCityDashboard,
  computeInstitutionalDeliveryMetrics,
  getWindowDays,
  parsePeriod,
  windowFromPeriod,
} from "@/lib/analytics";
import { RankingMapClient } from "@/app/ranking/RankingMapClient";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

function formatDuration(ms: number | null) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.round(m / 60);
  return `${h}h`;
}

function buildPeriodOptions(total = 12, now = new Date()) {
  return Array.from({ length: total }, (_, index) => {
    const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    const value = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = current.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
    return { value, label: label.slice(0, 1).toUpperCase() + label.slice(1) };
  });
}

function formatWindowLabel(period: string | null, windowDays: number) {
  if (!period) return `Indicadores por cidade e mapa de calor dos últimos ${windowDays} dias.`;
  const window = windowFromPeriod(period);
  if (!window) return `Indicadores por cidade e mapa de calor dos últimos ${windowDays} dias.`;
  const label = window.from.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return `Indicadores por cidade e mapa de calor de ${label.slice(0, 1).toUpperCase() + label.slice(1)}.`;
}

export default async function PrefeituraDashboardPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/home");

  const windowDays = getWindowDays(
    Array.isArray(props.searchParams?.windowDays)
      ? props.searchParams?.windowDays[0]
      : props.searchParams?.windowDays,
    30,
  );
  const rawPeriod = Array.isArray(props.searchParams?.period) ? props.searchParams?.period[0] : props.searchParams?.period;
  const period = parsePeriod(String(rawPeriod ?? "").trim()) ? String(rawPeriod).trim() : null;
  const periodOptions = buildPeriodOptions();

  const cityParam = Array.isArray(props.searchParams?.city) ? props.searchParams?.city[0] : props.searchParams?.city;
  const stateParam = Array.isArray(props.searchParams?.state)
    ? props.searchParams?.state[0]
    : props.searchParams?.state;
  const companyParam = Array.isArray(props.searchParams?.company)
    ? props.searchParams?.company[0]
    : props.searchParams?.company;
  const city = String(cityParam ?? user.city ?? "").trim();
  const state = String(stateParam ?? user.state ?? "").trim();
  const company = String(companyParam ?? "").trim();

  const data = city && state ? await computeCityDashboard(prisma, { city, state, windowDays, period }) : null;
  const companyRow = company
    ? await prisma.company.findFirst({
        where: { OR: [{ id: company }, { slug: company }] },
        select: { id: true, name: true, slug: true },
      })
    : null;
  const delivery = await computeInstitutionalDeliveryMetrics(prisma, {
    windowDays,
    period,
    city: city || null,
    state: state || null,
    companyId: companyRow?.id ?? null,
  });
  const cityCsvBase = data
    ? `/api/analytics/city?format=csv&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&${
        data.period ? `period=${encodeURIComponent(data.period)}` : `windowDays=${data.windowDays}`
      }`
    : "";
  const cityXlsxBase = data
    ? `/api/analytics/city?format=xlsx&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&${
        data.period ? `period=${encodeURIComponent(data.period)}` : `windowDays=${data.windowDays}`
      }`
    : "";
  const cityMetricsCsv = data
    ? `/api/cities/metrics?format=csv&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&limit=24`
    : "";
  const cityMetricsXlsx = data
    ? `/api/cities/metrics?format=xlsx&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&limit=24`
    : "";

  const companyRows = (data?.companyRank ?? []).slice(0, 10);
  const neighborhoodRows = Object.entries(data?.byNeighborhood ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/home" />
        <div className="flex items-center gap-4">
          <Link href="/alerts" className="text-sm text-primary hover:text-highlight">
            Alertas
          </Link>
          <Link href="/reports" className="text-sm text-primary hover:text-highlight">
            Relatórios
          </Link>
        </div>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="font-title font-bold text-2xl">Dashboard Estratégico (Prefeitura)</h1>
            <div className="text-sm text-foreground/70 mt-1">
              {formatWindowLabel(data?.period ?? period, data?.windowDays ?? windowDays)}
            </div>
          </div>

          <Card className="p-4">
            <form className="grid grid-cols-1 lg:grid-cols-6 gap-3">
              <div>
                <div className="text-xs text-foreground/60 mb-1">Cidade</div>
                <input
                  name="city"
                  defaultValue={city}
                  aria-label="Cidade"
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                  placeholder="Cidade"
                />
              </div>
              <div>
                <div className="text-xs text-foreground/60 mb-1">UF</div>
                <input
                  name="state"
                  defaultValue={state}
                  aria-label="UF"
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                  placeholder="UF"
                />
              </div>
              <div>
                <div className="text-xs text-foreground/60 mb-1">Empresa</div>
                <input
                  name="company"
                  defaultValue={company}
                  aria-label="Empresa"
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                  placeholder="slug ou id"
                />
              </div>
              <div>
                <div className="text-xs text-foreground/60 mb-1">Período</div>
                <select
                  name="period"
                  aria-label="Período"
                  defaultValue={data?.period ?? period ?? ""}
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                >
                  <option value="">Últimos {data?.windowDays ?? windowDays} dias</option>
                  {periodOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-xs text-foreground/60 mb-1">Janela</div>
                <select
                  name="windowDays"
                  aria-label="Janela de tempo"
                  defaultValue={String(windowDays)}
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                >
                  <option value="7">7 dias</option>
                  <option value="14">14 dias</option>
                  <option value="30">30 dias</option>
                  <option value="60">60 dias</option>
                  <option value="90">90 dias</option>
                </select>
                <div className="mt-1 text-[11px] text-foreground/60">A janela vale quando nenhum mês é selecionado.</div>
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="h-10 w-full rounded-xl bg-primary text-white px-4 font-title font-semibold hover:opacity-90"
                >
                  Aplicar
                </button>
              </div>
            </form>
            {company && !companyRow ? (
              <div className="text-xs text-foreground/70 mt-3">Empresa não encontrada (use slug ou id).</div>
            ) : null}
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="p-4">
              <div className="font-title font-bold text-lg">Entrega institucional (E-mail)</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="text-foreground/70">Taxa de sucesso</div>
                <div className="text-right font-title font-semibold">{delivery.email.successRate}%</div>
                <div className="text-foreground/70">Enviados</div>
                <div className="text-right">{delivery.email.sent}</div>
                <div className="text-foreground/70">Falhas</div>
                <div className="text-right">{delivery.email.failed}</div>
                <div className="text-foreground/70">Pendentes</div>
                <div className="text-right">{delivery.email.pending}</div>
                <div className="text-foreground/70">Reenvios</div>
                <div className="text-right">{delivery.email.retries}</div>
                <div className="text-foreground/70">Tempo médio</div>
                <div className="text-right">{formatDuration(delivery.email.avgSendMs)}</div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="font-title font-bold text-lg">Entrega institucional (Webhook)</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="text-foreground/70">Taxa de sucesso</div>
                <div className="text-right font-title font-semibold">{delivery.webhook.successRate}%</div>
                <div className="text-foreground/70">Enviados</div>
                <div className="text-right">{delivery.webhook.sent}</div>
                <div className="text-foreground/70">Falhas</div>
                <div className="text-right">{delivery.webhook.failed}</div>
                <div className="text-foreground/70">Pendentes</div>
                <div className="text-right">{delivery.webhook.pending}</div>
                <div className="text-foreground/70">Reenvios</div>
                <div className="text-right">{delivery.webhook.retries}</div>
                <div className="text-foreground/70">Tempo médio</div>
                <div className="text-right">{formatDuration(delivery.webhook.avgSendMs)}</div>
              </div>
            </Card>
          </div>

          {data ? (
            <>
              <Card className="p-4">
                <div className="font-title font-bold text-lg">Exportações</div>
                <div className="text-sm text-foreground/70 mt-1">Baixe os dados em CSV ou XLSX para BI e relatórios.</div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Link
                    href={`${cityCsvBase}&table=summary`}
                    className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
                  >
                    CSV (Resumo)
                  </Link>
                  <Link
                    href={`${cityCsvBase}&table=categories`}
                    className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
                  >
                    CSV (Categorias)
                  </Link>
                  <Link
                    href={`${cityCsvBase}&table=neighborhoods`}
                    className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
                  >
                    CSV (Bairros)
                  </Link>
                  <Link
                    href={`${cityCsvBase}&table=companies`}
                    className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
                  >
                    CSV (Empresas)
                  </Link>
                  <Link
                    href={cityMetricsCsv}
                    className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
                  >
                    CSV (Histórico)
                  </Link>
                  <Link
                    href={`${cityXlsxBase}&table=summary`}
                    className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
                  >
                    XLSX (Resumo)
                  </Link>
                  <Link
                    href={`${cityXlsxBase}&table=categories`}
                    className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
                  >
                    XLSX (Categorias)
                  </Link>
                  <Link
                    href={`${cityXlsxBase}&table=neighborhoods`}
                    className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
                  >
                    XLSX (Bairros)
                  </Link>
                  <Link
                    href={`${cityXlsxBase}&table=companies`}
                    className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
                  >
                    XLSX (Empresas)
                  </Link>
                  <Link
                    href={cityMetricsXlsx}
                    className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
                  >
                    XLSX (Histórico)
                  </Link>
                </div>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card className="p-4">
                  <div className="text-xs text-foreground/60">Reclamações</div>
                  <div className="font-title font-bold text-xl">{data.total}</div>
                  <div className="text-xs text-foreground/60 mt-1">Abertas: {data.open}</div>
                </Card>
                <Card className="p-4">
                  <div className="text-xs text-foreground/60">Taxas</div>
                  <div className="font-title font-bold text-xl">{data.solutionRate}%</div>
                  <div className="text-xs text-foreground/60 mt-1">Resposta: {data.responseRate}%</div>
                </Card>
                <Card className="p-4">
                  <div className="text-xs text-foreground/60">Pontos críticos</div>
                  <div className="font-title font-bold text-xl">{data.recurringCount}</div>
                  <div className="text-xs text-foreground/60 mt-1">Reincidências estimadas</div>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Card className="p-5">
                  <div className="font-title font-bold text-lg">Ranking de empresas</div>
                  <div className="mt-3 grid gap-2">
                    {companyRows.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-3">
                        <div className="text-sm">{c.name}</div>
                        <div className="text-sm text-foreground/70">
                          {c.solutionRate}% • {c.avgResponseMs == null ? "—" : `${Math.round(c.avgResponseMs / 60000)}min`}
                        </div>
                      </div>
                    ))}
                    {!companyRows.length ? (
                      <div className="text-sm text-foreground/70">Sem empresas com dados no período.</div>
                    ) : null}
                  </div>
                </Card>

                <Card className="p-5">
                  <div className="font-title font-bold text-lg">Bairros mais afetados</div>
                  <div className="mt-3 grid gap-2">
                    {neighborhoodRows.map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-3">
                        <div className="text-sm">{k}</div>
                        <div className="text-sm text-foreground/70">{v}</div>
                      </div>
                    ))}
                    {!neighborhoodRows.length ? (
                      <div className="text-sm text-foreground/70">Sem dados suficientes.</div>
                    ) : null}
                  </div>
                </Card>
              </div>

              <RankingMapClient initialCity={city} initialState={state} showCityStateFilter />
            </>
          ) : (
            <Card className="p-5">
              <div className="text-sm text-foreground/70">Informe cidade e UF para visualizar indicadores.</div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
