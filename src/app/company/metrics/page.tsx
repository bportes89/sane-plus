import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { UserRole } from "@/generated/prisma/client";

export default async function CompanyMetricsPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== UserRole.COMPANY || !user.companyId) redirect("/home");

  const limitRaw = props.searchParams?.limit;
  const limit = Math.max(
    1,
    Math.min(
      24,
      Number.parseInt(Array.isArray(limitRaw) ? limitRaw[0] ?? "12" : limitRaw ?? "12", 10) || 12,
    ),
  );
  const items = await prisma.companyMetric.findMany({
    where: { companyId: user.companyId },
    orderBy: { calculatedAt: "desc" },
    take: limit,
  });
  const rows = [...items].reverse();

  const maxReceived = Math.max(1, ...rows.map((r) => r.complaintsReceived));
  const maxReplied = Math.max(1, ...rows.map((r) => r.complaintsReplied));
  const maxResolved = Math.max(1, ...rows.map((r) => r.complaintsResolved));

  function pct(value: number, max: number) {
    const p = Math.round((value / max) * 100);
    return Math.min(100, Math.max(0, p));
  }

  function trend(curr?: number | null, prev?: number | null) {
    if (curr == null || prev == null || prev === 0) return null;
    const v = Math.round(((curr - prev) / prev) * 100);
    return v;
  }

  const last = rows[rows.length - 1] ?? null;
  const prev = rows[rows.length - 2] ?? null;
  const tReceived = trend(last?.complaintsReceived, prev?.complaintsReceived);
  const tReplied = trend(last?.complaintsReplied, prev?.complaintsReplied);
  const tResolved = trend(last?.complaintsResolved, prev?.complaintsResolved);

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/home" />
        <Link href="/company" className="text-sm text-primary hover:text-highlight">
          Voltar ao painel
        </Link>
      </header>
      <main className="px-6 py-10">
        <div className="w-full max-w-5xl mx-auto">
          <h1 className="font-title font-bold text-2xl">Métricas da Empresa</h1>
          <div className="text-sm text-foreground/70 mt-1">
            Tendências por período. Indicadores calculados automaticamente.
          </div>

          <Card className="mt-6 p-4">
            <form className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
              <div>
                <div className="text-xs text-foreground/60 mb-1">Períodos</div>
                <select
                  name="limit"
                  defaultValue={String(limit)}
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                >
                  <option value="3">Últimos 3</option>
                  <option value="6">Últimos 6</option>
                  <option value="12">Últimos 12</option>
                  <option value="24">Últimos 24</option>
                </select>
              </div>
              <div className="flex items-end gap-3">
                <button
                  type="submit"
                  className="h-10 rounded-xl bg-primary text-white px-4 font-title font-semibold hover:opacity-90"
                >
                  Aplicar
                </button>
                <a
                  href={`/api/companies/${user.companyId}/metrics/export?limit=${limit}`}
                  className="h-10 rounded-xl bg-secondary text-white px-4 font-title font-semibold flex items-center hover:opacity-90"
                >
                  Exportar CSV
                </a>
                <a
                  href={`/api/companies/${user.companyId}/metrics/export?limit=${limit}&format=xlsx`}
                  className="h-10 rounded-xl bg-secondary text-white px-4 font-title font-semibold flex items-center hover:opacity-90"
                >
                  Exportar XLSX
                </a>
              </div>
            </form>
          </Card>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-xs text-foreground/60">Recebidas</div>
              <div className="font-title font-bold text-xl">
                {last?.complaintsReceived ?? "—"}
                {tReceived != null ? (
                  <span className={tReceived >= 0 ? "text-[#b54708] text-xs ml-2" : "text-[#0d6b2f] text-xs ml-2"}>
                    {tReceived >= 0 ? `+${tReceived}%` : `${tReceived}%`}
                  </span>
                ) : null}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-foreground/60">Respondidas</div>
              <div className="font-title font-bold text-xl">
                {last?.complaintsReplied ?? "—"}
                {tReplied != null ? (
                  <span className={tReplied >= 0 ? "text-[#0d6b2f] text-xs ml-2" : "text-[#b54708] text-xs ml-2"}>
                    {tReplied >= 0 ? `+${tReplied}%` : `${tReplied}%`}
                  </span>
                ) : null}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-foreground/60">Resolvidas</div>
              <div className="font-title font-bold text-xl">
                {last?.complaintsResolved ?? "—"}
                {tResolved != null ? (
                  <span className={tResolved >= 0 ? "text-[#0d6b2f] text-xs ml-2" : "text-[#b54708] text-xs ml-2"}>
                    {tResolved >= 0 ? `+${tResolved}%` : `${tResolved}%`}
                  </span>
                ) : null}
              </div>
            </Card>
          </div>

          <Card className="mt-6 p-4">
            <div className="font-title font-bold text-lg">Distribuição por período</div>
            <div className="mt-4 grid gap-4">
              {rows.map((r) => (
                <div key={r.id} className="grid gap-2">
                  <div className="text-xs text-foreground/60">{r.period}</div>
                  <div className="grid gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-24 text-xs text-foreground/60">Recebidas</div>
                      <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-3 bg-primary rounded-full"
                          style={{ width: `${pct(r.complaintsReceived, maxReceived)}%` }}
                        />
                      </div>
                      <div className="w-10 text-xs text-foreground/60 text-right">{r.complaintsReceived}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-24 text-xs text-foreground/60">Respondidas</div>
                      <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-3 bg-[#5F3DC4] rounded-full"
                          style={{ width: `${pct(r.complaintsReplied, maxReplied)}%` }}
                        />
                      </div>
                      <div className="w-10 text-xs text-foreground/60 text-right">{r.complaintsReplied}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-24 text-xs text-foreground/60">Resolvidas</div>
                      <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-3 bg-[#0d6b2f] rounded-full"
                          style={{ width: `${pct(r.complaintsResolved, maxResolved)}%` }}
                        />
                      </div>
                      <div className="w-10 text-xs text-foreground/60 text-right">{r.complaintsResolved}</div>
                    </div>
                  </div>
                </div>
              ))}
              {!rows.length ? (
                <div className="text-sm text-foreground/70">Sem dados suficientes para exibir tendências.</div>
              ) : null}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
