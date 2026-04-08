import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { ReportScope, ReportType, UserRole } from "@/generated/prisma/client";
import { computeCompanyDashboard, getWindowDays } from "@/lib/analytics";
import { RankingMapClient } from "@/app/ranking/RankingMapClient";

function fmtMs(ms: number | null) {
  if (ms == null) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

export default async function CompanyDashboardPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== UserRole.COMPANY || !user.companyId) redirect("/home");

  const windowDays = getWindowDays(
    Array.isArray(props.searchParams?.windowDays)
      ? props.searchParams?.windowDays[0]
      : props.searchParams?.windowDays,
    30,
  );

  const data = await computeCompanyDashboard(prisma, { companyId: user.companyId, windowDays });

  const categoryRows = Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const neighborhoodRows = Object.entries(data.byNeighborhood).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const latestReport = await prisma.reportSnapshot.findFirst({
    where: { scope: ReportScope.COMPANY, type: ReportType.COMPANY_MONTHLY, companyId: user.companyId },
    orderBy: { generatedAt: "desc" },
    select: { id: true, period: true, generatedAt: true },
  });

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/company" />
        <div className="flex items-center gap-4">
          <Link href="/alerts" className="text-sm text-primary hover:text-highlight">
            Alertas
          </Link>
          <Link href="/reports" className="text-sm text-primary hover:text-highlight">
            Relatórios
          </Link>
          <Link href="/company/metrics" className="text-sm text-primary hover:text-highlight">
            Histórico
          </Link>
        </div>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="font-title font-bold text-2xl">Dashboard Operacional</h1>
            <div className="text-sm text-foreground/70 mt-1">
              Indicadores e padrões dos últimos {data.windowDays} dias.
            </div>
          </div>

          <Card className="p-4">
            <form className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
              <div>
                <div className="text-xs text-foreground/60 mb-1">Janela</div>
                <select
                  name="windowDays"
                  defaultValue={String(windowDays)}
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                >
                  <option value="7">7 dias</option>
                  <option value="14">14 dias</option>
                  <option value="30">30 dias</option>
                  <option value="60">60 dias</option>
                  <option value="90">90 dias</option>
                </select>
              </div>
              <div className="flex items-end gap-3">
                <button
                  type="submit"
                  className="h-10 rounded-xl bg-primary text-white px-4 font-title font-semibold hover:opacity-90"
                >
                  Aplicar
                </button>
              </div>
            </form>
          </Card>

          <Card className="p-5">
            <div className="font-title font-bold text-lg">Relatório institucional (mensal)</div>
            <div className="text-sm text-foreground/70 mt-1">
              Snapshot automático para distribuição e auditoria.
            </div>
            {latestReport ? (
              <div className="mt-3 rounded-2xl border border-black/10 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    {ReportType.COMPANY_MONTHLY} • {latestReport.period}
                  </div>
                  <div className="text-xs text-foreground/60">
                    {new Date(latestReport.generatedAt).toLocaleString("pt-BR")}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    href={`/api/reports/${latestReport.id}`}
                    className="text-xs text-primary hover:text-highlight"
                  >
                    JSON
                  </Link>
                  <a
                    href={`/api/reports/${latestReport.id}/export?format=xlsx&table=summary`}
                    className="text-xs text-primary hover:text-highlight"
                  >
                    XLSX (Resumo)
                  </a>
                  <a
                    href={`/api/reports/${latestReport.id}/export?format=xlsx&table=categories`}
                    className="text-xs text-primary hover:text-highlight"
                  >
                    XLSX (Categorias)
                  </a>
                  <a
                    href={`/api/reports/${latestReport.id}/export?format=csv&table=summary`}
                    className="text-xs text-primary hover:text-highlight"
                  >
                    CSV (Resumo)
                  </a>
                  <a
                    href={`/api/reports/${latestReport.id}/export?format=csv&table=categories`}
                    className="text-xs text-primary hover:text-highlight"
                  >
                    CSV (Categorias)
                  </a>
                </div>
              </div>
            ) : (
              <div className="text-sm text-foreground/70 mt-3">
                Nenhum snapshot disponível ainda.
              </div>
            )}
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
              <div className="text-xs text-foreground/60">Tempo</div>
              <div className="font-title font-bold text-xl">{fmtMs(data.avgResponseMs)}</div>
              <div className="text-xs text-foreground/60 mt-1">Resolução: {fmtMs(data.avgResolutionMs)}</div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="p-5">
              <div className="font-title font-bold text-lg">Por categoria</div>
              <div className="mt-3 grid gap-2">
                {categoryRows.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3">
                    <div className="text-sm">{k}</div>
                    <div className="text-sm text-foreground/70">{v}</div>
                  </div>
                ))}
                {!categoryRows.length ? (
                  <div className="text-sm text-foreground/70">Sem dados no período.</div>
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

          <Card className="p-5">
            <div className="font-title font-bold text-lg">Reincidências (bairro + categoria)</div>
            <div className="mt-3 grid gap-2">
              {data.recurring.slice(0, 10).map((r) => (
                <div key={`${r.neighborhood}:${r.category}`} className="flex items-center justify-between gap-3">
                  <div className="text-sm">
                    {r.neighborhood} • {r.category}
                  </div>
                  <div className="text-sm text-foreground/70">{r.count}</div>
                </div>
              ))}
              {!data.recurring.length ? (
                <div className="text-sm text-foreground/70">Nenhum padrão recorrente identificado.</div>
              ) : null}
            </div>
          </Card>

          <RankingMapClient showCityStateFilter={false} />
        </div>
      </main>
    </div>
  );
}
