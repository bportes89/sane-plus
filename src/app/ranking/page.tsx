import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Card } from "@/components/Card";
import { RankingMapClient } from "./RankingMapClient";

export const dynamic = "force-dynamic";

export default async function RankingPage() {
  const companies = await prisma.company.findMany({
    include: {
      complaints: {
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
    const last30 = c.complaints.filter(
      (x) => Date.now() - new Date(x.createdAt).getTime() <= 30 * 24 * 60 * 60 * 1000,
    ).length;

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
      last30,
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
                      <div>Taxa de solução: {r.solutionRate}%</div>
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
