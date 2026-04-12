import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Card } from "@/components/Card";
import { RankingMapClient } from "./RankingMapClient";
import { getWindowDays, parsePeriod, windowFromDays, windowFromPeriod } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function buildPeriodOptions(total = 12, now = new Date()) {
  return Array.from({ length: total }, (_, index) => {
    const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    const value = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = current.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
    return { value, label: label.slice(0, 1).toUpperCase() + label.slice(1) };
  });
}

function resolveWindowLabel(period: string | null, windowDays: number) {
  if (!period) return `Últimos ${windowDays} dias`;
  const window = windowFromPeriod(period);
  if (!window) return `Últimos ${windowDays} dias`;
  const label = window.from.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return label.slice(0, 1).toUpperCase() + label.slice(1);
}

export default async function RankingPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const rawPeriod = Array.isArray(props.searchParams?.period) ? props.searchParams?.period[0] : props.searchParams?.period;
  const rawWindowDays = Array.isArray(props.searchParams?.windowDays)
    ? props.searchParams?.windowDays[0]
    : props.searchParams?.windowDays;
  const period = parsePeriod(String(rawPeriod ?? "").trim()) ? String(rawPeriod).trim() : null;
  const windowDays = getWindowDays(rawWindowDays, 30);
  const selectedWindow = (period ? windowFromPeriod(period) : null) ?? windowFromDays(windowDays, new Date());
  const periodOptions = buildPeriodOptions();
  const companies = await prisma.company.findMany({
    include: {
      complaints: {
        where: { createdAt: { gte: selectedWindow.from, lte: selectedWindow.to } },
        select: {
          id: true,
          status: true,
          createdAt: true,
          resolvedAt: true,
          responses: { select: { createdAt: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  const rows = companies.map((c) => {
    const total = c.complaints.length;
    const resolved = c.complaints.filter((x) => x.status === "RESOLVED").length;
    const notResponded = c.complaints.filter((x) => x.responses.length === 0).length;

    const avgResponseMs = (() => {
      const diffs = c.complaints
        .filter((x) => x.responses.length > 0)
        .map(
          (x) =>
            new Date(x.responses[0].createdAt).getTime() -
            new Date(x.createdAt).getTime(),
        );
      if (diffs.length === 0) return null;
      return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
    })();

    const solutionRate = total ? Math.round((resolved / total) * 100) : 0;
    const saneIndex =
      solutionRate +
      (avgResponseMs ? Math.max(0, 100 - Math.round(avgResponseMs / 360000)) : 50);

    return {
      id: c.id,
      name: c.name,
      total,
      resolved,
      notResponded,
      solutionRate,
      avgResponseMs,
      saneIndex,
    };
  }).sort((a, b) => b.saneIndex - a.saneIndex);

  const formatAvg = (ms: number | null) => {
    if (!ms) return "—";
    const days = Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
    return `${days} dia${days === 1 ? "" : "s"}`;
  };

  return (
    <div className="min-h-dvh bg-background px-6 py-8">
      <div className="w-full max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-title font-bold text-2xl">Ranking das Empresas</h1>
          <Link href="/home" className="text-sm text-primary hover:text-highlight">
            Voltar
          </Link>
        </div>

        <Card className="mt-4 p-4">
          <form className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
            <div>
              <div className="text-xs text-foreground/60 mb-1">Período</div>
              <select
                name="period"
                aria-label="Período do ranking"
                defaultValue={period ?? ""}
                className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
              >
                <option value="">Últimos {windowDays} dias</option>
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

        <RankingMapClient />

        <div className="mt-5 grid gap-3">
          {rows.map((r) => {
            const note = Math.max(
              0,
              Math.min(5, Math.round((r.saneIndex / 20) * 10) / 10),
            );
            return (
              <Link key={r.id} href={`/companies/${r.id}`} className="block">
                <Card className="p-6 hover:bg-muted transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-title font-semibold text-lg">{r.name}</div>
                      <div className="text-sm text-foreground/70 mt-1">
                        Nota SANE+: <span className="font-title font-semibold text-foreground">{note}</span>
                      </div>
                    </div>
                    <div className="text-right text-xs text-foreground/60">
                      <div>Período: {resolveWindowLabel(period, windowDays)}</div>
                      <div>Taxa de solução: {r.solutionRate}%</div>
                      <div>Sem resposta: {r.notResponded}</div>
                      <div>Tempo médio: {formatAvg(r.avgResponseMs)}</div>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}

          {!rows.length ? (
            <Card className="p-6">
              <div className="text-sm text-foreground/70">Sem empresas cadastradas.</div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
