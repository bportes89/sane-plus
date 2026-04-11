import Link from "next/link";
import { Logo } from "@/components/Logo";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card } from "@/components/Card";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/home&clear=1");

  const complaints = await prisma.complaint.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: {
      id: true,
      issue: true,
      status: true,
      createdAt: true,
      company: { select: { name: true } },
    },
  });

  const topCompanies = await prisma.company.findMany({
    take: 3,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      complaints: {
        select: {
          status: true,
          createdAt: true,
          responses: { select: { createdAt: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  const rankingPreview = topCompanies.map((c) => {
    const total = c.complaints.length;
    const resolved = c.complaints.filter((x) => x.status === "RESOLVED").length;
    const solutionRate = total ? Math.round((resolved / total) * 100) : 0;
    const avgResponseMs = (() => {
      const diffs = c.complaints
        .filter((x) => x.responses.length > 0)
        .map((x) => new Date(x.responses[0].createdAt).getTime() - new Date(x.createdAt).getTime());
      if (diffs.length === 0) return null;
      return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
    })();
    return {
      id: c.id,
      name: c.name,
      solutionRate,
      avgResponseMs,
    };
  });

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
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6">
        <div className="rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.96)_0%,rgba(245,238,255,0.98)_48%,rgba(238,243,255,0.98)_100%)] px-5 py-4 shadow-[0_24px_60px_rgba(95,61,196,0.10)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <Logo href="/home" />
                <span className="inline-flex items-center rounded-full border border-[#E7D7FF] bg-white/80 px-3 py-1 text-[11px] font-title font-semibold uppercase tracking-[0.14em] text-[#820AD1]">
                  Painel do cidadão
                </span>
              </div>
              <div className="mt-3">
                <div className="text-sm text-foreground/70">Olá, {user.name ?? "cidadão"}.</div>
                <div className="font-title font-bold text-xl text-foreground">
                  Sua central SANE+ para acompanhar reclamações e respostas.
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/support"
                className="relative inline-flex h-12 w-12 items-center justify-center overflow-hidden rounded-[1.25rem] border border-[#E7D7FF] bg-[linear-gradient(180deg,#FFFFFF_0%,#F5EEFF_100%)] text-[#5F3DC4] shadow-[0_10px_24px_rgba(130,10,209,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(130,10,209,0.18)]"
                aria-label="Suporte"
              >
                <span className="absolute inset-x-2 top-0 h-5 rounded-full bg-white/70 blur-md" />
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="relative z-10">
                  <path
                    d="M8 10.5h8M8 14h4.5M7 18.5h5l3.8 2.7c.4.3 1 .01 1-.49V18.5h.7A2.5 2.5 0 0 0 20 16V7.5A2.5 2.5 0 0 0 17.5 5h-11A2.5 2.5 0 0 0 4 7.5V16A2.5 2.5 0 0 0 6.5 18.5H7Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
              <Link
                href="/notifications"
                className="relative inline-flex h-12 w-12 items-center justify-center overflow-hidden rounded-[1.25rem] border border-[#D8E3FF] bg-[linear-gradient(180deg,#FFFFFF_0%,#EEF3FF_100%)] text-[#3F51C4] shadow-[0_10px_24px_rgba(95,61,196,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(95,61,196,0.18)]"
                aria-label="Notificações"
              >
                <span className="absolute inset-x-2 top-0 h-5 rounded-full bg-white/75 blur-md" />
                <span className="absolute right-2.5 top-2.5 z-10 h-2.5 w-2.5 rounded-full bg-[#9B4DFF] ring-2 ring-white" />
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="relative z-10">
                  <path
                    d="M12 4.75a4.25 4.25 0 0 1 4.25 4.25v1.16c0 .8.2 1.58.58 2.28l.74 1.36c.57 1.06-.2 2.37-1.4 2.37H7.83c-1.2 0-1.97-1.31-1.4-2.37l.74-1.36c.38-.7.58-1.48.58-2.28V9A4.25 4.25 0 0 1 12 4.75Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M10 18.25a2.25 2.25 0 0 0 4 0"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
              <Link
                href="/profile"
                className="relative inline-flex h-12 w-12 items-center justify-center overflow-hidden rounded-[1.25rem] border border-[#E7D7FF] bg-[linear-gradient(180deg,#FFFFFF_0%,#F7EFFF_100%)] text-[#820AD1] shadow-[0_10px_24px_rgba(130,10,209,0.14)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(130,10,209,0.2)]"
                aria-label="Perfil"
              >
                <span className="absolute inset-x-2 top-0 h-5 rounded-full bg-white/75 blur-md" />
                <span className="absolute bottom-1.5 right-1.5 h-3.5 w-3.5 rounded-full border border-white bg-[#22C1A8]" />
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="relative z-10">
                  <path
                    d="M12 12a3.75 3.75 0 1 0 0-7.5A3.75 3.75 0 0 0 12 12Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M5.5 19.25a6.5 6.5 0 0 1 13 0"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </header>
      <main className="px-6 py-10 space-y-8">
        <div className="rounded-3xl bg-white border border-black/5 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-foreground/70">Olá, {user.name ?? "cidadão"}.</div>
              <div className="font-title font-bold text-xl text-foreground">
                Vamos resolver isso juntos.
              </div>
            </div>
            <Link href="/complaints/new" prefetch={false} className="inline-flex shrink-0">
              <span className="inline-flex min-w-[210px] items-center justify-center rounded-xl font-title font-semibold h-11 px-4 text-base bg-accent text-white hover:bg-highlight active:bg-primary btn-glow">
                Registrar Reclamação
              </span>
            </Link>
          </div>
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-title font-bold text-lg">Minhas Reclamações</h2>
            <Link href="/complaints" className="text-sm text-primary hover:text-highlight">
              Ver todas
            </Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {complaints.length ? (
              complaints.map((c) => (
                <Link key={c.id} href={`/complaints/${c.id}`} className="block">
                  <Card className="p-5 hover:bg-muted transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-title font-semibold">{c.issue}</div>
                        <div className="text-sm text-foreground/70 mt-1">{c.company.name}</div>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-title font-semibold">
                        {statusLabel[c.status] ?? c.status}
                      </span>
                    </div>
                  </Card>
                </Link>
              ))
            ) : (
              <Card className="p-5">
                <div className="text-sm text-foreground/70">
                  Você ainda não registrou nenhuma reclamação.
                </div>
              </Card>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-title font-bold text-lg">Ranking das Empresas</h2>
            <Link href="/ranking" className="text-sm text-primary hover:text-highlight">
              Abrir ranking
            </Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {rankingPreview.map((r) => (
              <Card key={r.id} className="p-5">
                <div className="font-title font-semibold">{r.name}</div>
                <div className="mt-2 text-sm text-foreground/70">
                  Nota SANE+: <span className="text-foreground font-title font-semibold">{r.solutionRate}</span>
                </div>
                <div className="text-xs text-foreground/60 mt-1">
                  Taxa de solução: {r.solutionRate}%
                </div>
              </Card>
            ))}
            {!rankingPreview.length ? (
              <Card className="p-5">
                <div className="text-sm text-foreground/70">Sem dados ainda.</div>
              </Card>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-title font-bold text-lg">Alertas</h2>
            <Link href="/news" className="text-sm text-primary hover:text-highlight">
              Ver todos
            </Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="p-5">
              <div className="font-title font-semibold">Manutenção programada</div>
              <div className="text-sm text-foreground/70 mt-1">
                Possível interrupção de água no bairro X.
              </div>
            </Card>
            <Card className="p-5">
              <div className="font-title font-semibold">Alto volume de reclamações</div>
              <div className="text-sm text-foreground/70 mt-1">
                Crescimento de relatos na região Y nas últimas 24h.
              </div>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}
