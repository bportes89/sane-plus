import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { computePublicDashboard } from "@/lib/analytics";
import { RankingMapClient } from "@/app/ranking/RankingMapClient";

export default async function TransparenciaPage() {
  const data = await computePublicDashboard(prisma, { windowDays: 30 });
  const top = data.topCompanies.slice(0, 10);

  const exportCsvBase = "/api/analytics/public?format=csv&windowDays=30";
  const exportXlsxBase = "/api/analytics/public?format=xlsx&windowDays=30";

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
            <div className="text-sm text-foreground/70 mt-1">Indicadores públicos (últimos 30 dias).</div>
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
