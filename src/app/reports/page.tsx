import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { ReportScope, ReportType, UserRole } from "@/generated/prisma/client";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

export default async function ReportsPage() {
  const user = await getCurrentUser();

  const scope: ReportScope = !user
    ? ReportScope.PUBLIC
    : user.role === UserRole.COMPANY
      ? ReportScope.COMPANY
      : isStaff(user.role)
        ? ReportScope.CITY
        : ReportScope.PUBLIC;

  if (user && user.role !== UserRole.COMPANY && !isStaff(user.role)) redirect("/home");

  const where =
    scope === ReportScope.PUBLIC
      ? { scope: ReportScope.PUBLIC }
      : scope === ReportScope.COMPANY && user?.companyId
        ? { scope: ReportScope.COMPANY, companyId: user.companyId }
        : isStaff(user?.role as UserRole)
          ? {}
          : { scope: ReportScope.PUBLIC };

  const reports = await prisma.reportSnapshot.findMany({
    where,
    orderBy: { generatedAt: "desc" },
    take: 40,
    select: { id: true, type: true, scope: true, period: true, generatedAt: true, city: true, state: true },
  });

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/home" />
        <div className="flex items-center gap-4">
          <Link href="/alerts" className="text-sm text-primary hover:text-highlight">
            Alertas
          </Link>
          <Link href="/transparencia" className="text-sm text-primary hover:text-highlight">
            Transparência
          </Link>
        </div>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="font-title font-bold text-2xl">Relatórios</h1>
            <div className="text-sm text-foreground/70 mt-1">Snapshots mensais, trimestrais e anuais.</div>
          </div>

          {user && isStaff(user.role) ? (
            <Card className="p-5">
              <div className="font-title font-bold text-lg">Gerar novo</div>
              <div className="text-sm text-foreground/70 mt-1">
                Geração via API interna. Os dados são agregados e armazenados como snapshot.
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4">
                <form action="/api/reports/generate" method="post" className="rounded-2xl border border-black/10 p-4">
                  <div className="font-title font-semibold">Cidade (mensal)</div>
                  <input type="hidden" name="type" value={ReportType.CITY_MONTHLY} />
                  <div className="grid grid-cols-1 gap-2 mt-3">
                    <input
                      name="city"
                      placeholder="Cidade"
                      aria-label="Cidade"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <input
                      name="state"
                      placeholder="UF"
                      aria-label="UF"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <input
                      name="period"
                      placeholder="YYYY-MM (ex: 2026-03)"
                      aria-label="Período (YYYY-MM)"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" name="publish" value="true" className="h-4 w-4" />
                      Publicar
                    </label>
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" name="distribute" value="true" className="h-4 w-4" />
                      Distribuir (integrações)
                    </label>
                    <button
                      type="submit"
                      className="h-10 rounded-xl bg-primary text-white px-4 font-title font-semibold hover:opacity-90"
                    >
                      Gerar
                    </button>
                  </div>
                </form>

                <form action="/api/reports/generate" method="post" className="rounded-2xl border border-black/10 p-4">
                  <div className="font-title font-semibold">Cidade (mensal, institucional)</div>
                  <input type="hidden" name="type" value={ReportType.INSTITUTIONAL_MONTHLY} />
                  <div className="grid grid-cols-1 gap-2 mt-3">
                    <input
                      name="city"
                      placeholder="Cidade"
                      aria-label="Cidade"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <input
                      name="state"
                      placeholder="UF"
                      aria-label="UF"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <input
                      name="period"
                      placeholder="YYYY-MM (ex: 2026-03)"
                      aria-label="Período (YYYY-MM)"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" name="publish" value="true" className="h-4 w-4" />
                      Publicar
                    </label>
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" name="distribute" value="true" className="h-4 w-4" />
                      Distribuir (integrações)
                    </label>
                    <button
                      type="submit"
                      className="h-10 rounded-xl bg-primary text-white px-4 font-title font-semibold hover:opacity-90"
                    >
                      Gerar
                    </button>
                  </div>
                </form>

                <form
                  action="/api/reports/generate"
                  method="post"
                  className="rounded-2xl border border-black/10 p-4"
                >
                  <div className="font-title font-semibold">Região (trimestral)</div>
                  <input type="hidden" name="type" value={ReportType.REGIONAL_QUARTERLY} />
                  <div className="grid grid-cols-1 gap-2 mt-3">
                    <input
                      name="state"
                      placeholder="UF"
                      aria-label="UF"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <input
                      name="year"
                      placeholder="Ano (ex: 2026)"
                      aria-label="Ano"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <input
                      name="quarter"
                      placeholder="Trimestre (1-4)"
                      aria-label="Trimestre"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" name="publish" value="true" className="h-4 w-4" />
                      Publicar
                    </label>
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" name="distribute" value="true" className="h-4 w-4" />
                      Distribuir (integrações)
                    </label>
                    <button
                      type="submit"
                      className="h-10 rounded-xl bg-primary text-white px-4 font-title font-semibold hover:opacity-90"
                    >
                      Gerar
                    </button>
                  </div>
                </form>

                <form
                  action="/api/reports/generate"
                  method="post"
                  className="rounded-2xl border border-black/10 p-4"
                >
                  <div className="font-title font-semibold">Região (trimestral, institucional)</div>
                  <input type="hidden" name="type" value={ReportType.INSTITUTIONAL_QUARTERLY} />
                  <div className="grid grid-cols-1 gap-2 mt-3">
                    <input
                      name="state"
                      placeholder="UF"
                      aria-label="UF"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <input
                      name="year"
                      placeholder="Ano (ex: 2026)"
                      aria-label="Ano"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <input
                      name="quarter"
                      placeholder="Trimestre (1-4)"
                      aria-label="Trimestre"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" name="publish" value="true" className="h-4 w-4" />
                      Publicar
                    </label>
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" name="distribute" value="true" className="h-4 w-4" />
                      Distribuir (integrações)
                    </label>
                    <button
                      type="submit"
                      className="h-10 rounded-xl bg-primary text-white px-4 font-title font-semibold hover:opacity-90"
                    >
                      Gerar
                    </button>
                  </div>
                </form>

                <form action="/api/reports/generate" method="post" className="rounded-2xl border border-black/10 p-4">
                  <div className="font-title font-semibold">Nacional (anual)</div>
                  <input type="hidden" name="type" value={ReportType.NATIONAL_ANNUAL} />
                  <div className="grid grid-cols-1 gap-2 mt-3">
                    <input
                      name="year"
                      placeholder="Ano (ex: 2026)"
                      aria-label="Ano"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" name="publish" value="true" className="h-4 w-4" />
                      Publicar
                    </label>
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" name="distribute" value="true" className="h-4 w-4" />
                      Distribuir (integrações)
                    </label>
                    <button
                      type="submit"
                      className="h-10 rounded-xl bg-primary text-white px-4 font-title font-semibold hover:opacity-90"
                    >
                      Gerar
                    </button>
                  </div>
                </form>

                <form action="/api/reports/generate" method="post" className="rounded-2xl border border-black/10 p-4">
                  <div className="font-title font-semibold">Nacional (anual, institucional)</div>
                  <input type="hidden" name="type" value={ReportType.INSTITUTIONAL_ANNUAL} />
                  <div className="grid grid-cols-1 gap-2 mt-3">
                    <input
                      name="year"
                      placeholder="Ano (ex: 2026)"
                      aria-label="Ano"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" name="publish" value="true" className="h-4 w-4" />
                      Publicar
                    </label>
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" name="distribute" value="true" className="h-4 w-4" />
                      Distribuir (integrações)
                    </label>
                    <button
                      type="submit"
                      className="h-10 rounded-xl bg-primary text-white px-4 font-title font-semibold hover:opacity-90"
                    >
                      Gerar
                    </button>
                  </div>
                </form>
                <form action="/api/reports/generate" method="post" className="rounded-2xl border border-black/10 p-4">
                  <div className="font-title font-semibold">Empresa (mensal)</div>
                  <input type="hidden" name="type" value={ReportType.COMPANY_MONTHLY} />
                  <div className="grid grid-cols-1 gap-2 mt-3">
                    <input
                      name="companyId"
                      placeholder="companyId"
                      aria-label="companyId"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <input
                      name="period"
                      placeholder="YYYY-MM (ex: 2026-03)"
                      aria-label="Período (YYYY-MM)"
                      className="h-10 rounded-xl border border-black/10 bg-white px-3 outline-none"
                    />
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" name="distribute" value="true" className="h-4 w-4" />
                      Distribuir (integrações)
                    </label>
                    <button
                      type="submit"
                      className="h-10 rounded-xl bg-primary text-white px-4 font-title font-semibold hover:opacity-90"
                    >
                      Gerar
                    </button>
                  </div>
                </form>
              </div>
            </Card>
          ) : null}

          <Card className="p-5">
            <div className="font-title font-bold text-lg">Snapshots recentes</div>
            <div className="mt-3 grid gap-2">
              {reports.map((r) => {
                const base = `/api/reports/${r.id}`;
                const exportBase = `${base}/export`;
                return (
                  <div key={r.id} className="rounded-2xl border border-black/10 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm">
                        {r.type} • {r.period}
                        {r.city && r.state ? ` • ${r.city}/${r.state}` : ""}
                      </div>
                      <div className="text-xs text-foreground/60">{new Date(r.generatedAt).toLocaleString("pt-BR")}</div>
                    </div>
                    <div className="text-xs text-foreground/60 mt-1">{r.scope}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link href={base} className="text-xs text-primary hover:text-highlight">
                        JSON
                      </Link>
                      <a
                        href={`${exportBase}?format=xlsx&table=summary`}
                        className="text-xs text-primary hover:text-highlight"
                      >
                        XLSX (Resumo)
                      </a>
                      <a
                        href={`${exportBase}?format=xlsx&table=categories`}
                        className="text-xs text-primary hover:text-highlight"
                      >
                        XLSX (Categorias)
                      </a>
                      <a href={`${exportBase}?format=csv&table=summary`} className="text-xs text-primary hover:text-highlight">
                        CSV (Resumo)
                      </a>
                      <a
                        href={`${exportBase}?format=csv&table=categories`}
                        className="text-xs text-primary hover:text-highlight"
                      >
                        CSV (Categorias)
                      </a>
                    </div>
                  </div>
                );
              })}
              {!reports.length ? <div className="text-sm text-foreground/70">Sem snapshots.</div> : null}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
