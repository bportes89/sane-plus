import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/Card";

export default async function CompanyProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyKey = String(id ?? "").trim();
  if (!companyKey) notFound();

  const include = {
    complaints: {
      orderBy: { createdAt: "desc" as const },
      take: 10,
      select: {
        id: true,
        issue: true,
        status: true,
        createdAt: true,
        responses: { select: { createdAt: true }, orderBy: { createdAt: "asc" as const } },
      },
    },
  };

  const company =
    (await prisma.company.findUnique({
      where: { id: companyKey },
      include,
    })) ??
    (await prisma.company.findUnique({
      where: { slug: companyKey },
      include,
    }));

  if (!company) {
    return (
      <div className="min-h-dvh bg-background px-6 py-8">
        <div className="w-full max-w-3xl mx-auto">
          <div className="font-title font-bold text-2xl">Empresa não encontrada</div>
          <div className="mt-4">
            <Link href="/ranking" className="text-sm text-primary hover:text-highlight">
              Voltar ao ranking
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const total = company.complaints.length;
  const resolved = company.complaints.filter((x) => x.status === "RESOLVED").length;
  const solutionRate = total ? Math.round((resolved / total) * 100) : 0;
  const avgResponseMs = (() => {
    const diffs = company.complaints
      .filter((x) => x.responses.length > 0)
      .map(
        (x) =>
          new Date(x.responses[0].createdAt).getTime() -
          new Date(x.createdAt).getTime(),
      );
    if (diffs.length === 0) return null;
    return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
  })();
  const avgDays = avgResponseMs
    ? Math.max(1, Math.round(avgResponseMs / (24 * 60 * 60 * 1000)))
    : null;
  const saneIndex = solutionRate + (avgResponseMs ? Math.max(0, 100 - Math.round(avgResponseMs / 360000)) : 50);
  const note = Math.max(0, Math.min(5, Math.round((saneIndex / 20) * 10) / 10));

  const statusLabel: Record<string, string> = {
    REGISTERED: "Aberta",
    NEEDS_REVIEW: "Em análise",
    PUBLISHED: "Publicada",
    COMPANY_REPLIED: "Respondida",
    USER_CONTESTED: "Contestada",
    RESOLVED: "Resolvida",
    CLOSED: "Encerrada",
  };

  return (
    <div className="min-h-dvh bg-background px-6 py-8">
      <div className="w-full max-w-3xl mx-auto">
        <header className="flex items-center justify-between gap-4">
          <Link href="/ranking" className="text-sm text-primary hover:text-highlight">
            &lt; Voltar
          </Link>
        </header>

        <Card className="mt-6 p-6">
          <div className="font-title font-bold text-2xl">{company.name}</div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl border border-[#E7D7FF] bg-[#F5EEFF] px-4 py-3 text-[#2B2B2B]">
              <div className="text-[#5F3DC4]">Nota SANE+</div>
              <div className="font-title font-semibold text-lg text-[#2B2B2B]">{note}</div>
            </div>
            <div className="rounded-2xl border border-[#E7D7FF] bg-[#F5EEFF] px-4 py-3 text-[#2B2B2B]">
              <div className="text-[#5F3DC4]">Taxa de solução</div>
              <div className="font-title font-semibold text-lg text-[#2B2B2B]">{solutionRate}%</div>
            </div>
            <div className="rounded-2xl border border-[#E7D7FF] bg-[#F5EEFF] px-4 py-3 text-[#2B2B2B]">
              <div className="text-[#5F3DC4]">Tempo médio de resposta</div>
              <div className="font-title font-semibold text-lg text-[#2B2B2B]">
                {avgDays ? `${avgDays} dia${avgDays === 1 ? "" : "s"}` : "—"}
              </div>
            </div>
            <div className="rounded-2xl border border-[#E7D7FF] bg-[#F5EEFF] px-4 py-3 text-[#2B2B2B]">
              <div className="text-[#5F3DC4]">Reclamações recentes</div>
              <div className="font-title font-semibold text-lg text-[#2B2B2B]">{total}</div>
            </div>
          </div>
        </Card>

        <section className="mt-6 space-y-3">
          <h2 className="font-title font-bold text-lg">Reclamações recentes</h2>
          <div className="grid gap-2">
            {company.complaints.map((c) => (
              <Card key={c.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-title font-semibold">{c.issue}</div>
                    <div className="text-xs text-foreground/60 mt-1">
                      {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-title font-semibold">
                    {statusLabel[c.status] ?? c.status}
                  </span>
                </div>
              </Card>
            ))}
            {!company.complaints.length ? (
              <Card className="p-5">
                <div className="text-sm text-foreground/70">Sem reclamações ainda.</div>
              </Card>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
