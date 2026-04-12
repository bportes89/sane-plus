import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { computePublicDashboard, getWindowDays, parsePeriod, windowFromPeriod } from "@/lib/analytics";
import { RankingMapClient } from "@/app/ranking/RankingMapClient";

export const dynamic = "force-dynamic";

function buildPeriodOptions(total = 12, now = new Date()) {
  return Array.from({ length: total }, (_, index) => {
    const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    const value = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = current.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
    return { value, label: label.slice(0, 1).toUpperCase() + label.slice(1) };
  });
}

function formatFilterLabel(period: string | null, windowDays: number) {
  if (!period) return `Indicadores públicos (últimos ${windowDays} dias).`;
  const window = windowFromPeriod(period);
  if (!window) return `Indicadores públicos (últimos ${windowDays} dias).`;
  const label = window.from.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return `Indicadores públicos (${label.slice(0, 1).toUpperCase() + label.slice(1)}).`;
}

export default async function TransparenciaPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const rawPeriod = Array.isArray(props.searchParams?.period) ? props.searchParams?.period[0] : props.searchParams?.period;
  const rawWindowDays = Array.isArray(props.searchParams?.windowDays)
    ? props.searchParams?.windowDays[0]
    : props.searchParams?.windowDays;
  const period = parsePeriod(String(rawPeriod ?? "").trim()) ? String(rawPeriod).trim() : null;
  const windowDays = getWindowDays(rawWindowDays, 30);
  const data = await computePublicDashboard(prisma, { windowDays, period });
  const top = data.topCompanies.slice(0, 10);
  const periodOptions = buildPeriodOptions();
  const exportBase = data.period
    ? `period=${encodeURIComponent(data.period)}`
    : `windowDays=${data.windowDays}`;

  const exportCsvBase = `/api/analytics/public?format=csv&${exportBase}`;
  const exportXlsxBase = `/api/analytics/public?format=xlsx&${exportBase}`;

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/home" />
        <div className="flex items-center gap-4">
          <Link href="/ranking" className="text-sm text-primary hover:text-highlight">
            Ranking
          </Link>
          <Link href="/news" className="text-sm text-primary hover:text-highlight">
            Notícias
          </Link>
        </div>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="font-title font-bold text-2xl">Transparência</h1>
            <div className="text-sm text-foreground/70 mt-1">{formatFilterLabel(data.period, data.windowDays)}</div>
            <Card className="mt-4 p-4">
              <form className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
                <div>
                  <div className="text-xs text-foreground/60 mb-1">Período</div>
                  <select
                    name="period"
                    aria-label="Período"
                    defaultValue={data.period ?? ""}
                    className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                  >
                    <option value="">Últimos {data.windowDays} dias</option>
                    {periodOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-primary px-4 font-title font-semibold text-white transition hover:opacity-90"
                  >
                    Aplicar filtro
                  </button>
                </div>
              </form>
            </Card>
            <div className="flex flex-wrap gap-2 mt-3">
              <Link
                href={`${exportCsvBase}&table=summary`}
                className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
              >
                Baixar CSV (Resumo)
              </Link>
              <Link
                href={`${exportCsvBase}&table=categories`}
                className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
              >
                Baixar CSV (Categorias)
              </Link>
              <Link
                href={`${exportCsvBase}&table=companies`}
                className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
              >
                Baixar CSV (Empresas)
              </Link>
              <Link
                href={`${exportXlsxBase}&table=summary`}
                className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
              >
                Baixar XLSX (Resumo)
              </Link>
              <Link
                href={`${exportXlsxBase}&table=categories`}
                className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
              >
                Baixar XLSX (Categorias)
              </Link>
              <Link
                href={`${exportXlsxBase}&table=companies`}
                className="inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors h-9 px-3 text-sm bg-white text-primary border border-black/10 hover:bg-muted"
              >
                Baixar XLSX (Empresas)
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-xs text-foreground/60">Reclamações</div>
              <div className="font-title font-bold text-xl">{data.total}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-foreground/60">Taxa de resposta</div>
              <div className="font-title font-bold text-xl">{data.responseRate}%</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-foreground/60">Taxa de solução</div>
              <div className="font-title font-bold text-xl">{data.solutionRate}%</div>
            </Card>
          </div>

          <Card className="p-5">
            <div className="font-title font-bold text-lg">Empresas em destaque</div>
            <div className="mt-3 grid gap-2">
              {top.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3">
                  <div className="text-sm">{c.name}</div>
                  <div className="text-sm text-foreground/70">
                    {c.solutionRate}% • {c.avgResponseMs == null ? "—" : `${Math.round(c.avgResponseMs / 60000)}min`}
                  </div>
                </div>
              ))}
              {!top.length ? <div className="text-sm text-foreground/70">Sem dados.</div> : null}
            </div>
          </Card>

          <RankingMapClient showCityStateFilter={false} />
        </div>
      </main>
    </div>
  );
}
