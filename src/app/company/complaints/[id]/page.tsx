import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { UserRole } from "@/generated/prisma/client";
import { CompanyActions } from "./CompanyActions";

export default async function CompanyComplaintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== UserRole.COMPANY || !user.companyId) redirect("/home");

  const { id } = await params;
  const complaint = await prisma.complaint.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      user: { select: { name: true, email: true } },
      events: { orderBy: { createdAt: "asc" } },
      responses: { orderBy: { createdAt: "asc" }, include: { attachments: { orderBy: { createdAt: "desc" } } } },
      attachments: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!complaint || complaint.companyId !== user.companyId) {
    return (
      <div className="min-h-dvh bg-background px-6 py-8">
        <div className="w-full max-w-4xl mx-auto">
          <div className="font-title font-bold text-2xl">Reclamação não encontrada</div>
          <div className="mt-4">
            <Link href="/company" className="text-sm text-primary hover:text-highlight">
              Voltar ao painel
            </Link>
          </div>
        </div>
      </div>
    );
  }

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
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/home" />
        <Link href="/company" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="font-title font-bold text-2xl">Detalhes da Reclamação</h1>
            <div className="text-sm text-foreground/70 mt-1">
              Status: <span className="text-foreground">{statusLabel[complaint.status] ?? complaint.status}</span>
            </div>
          </div>

          <Card className="p-6">
            <div className="font-title font-bold text-xl">{complaint.issue}</div>
            <div className="text-sm text-foreground/70 mt-1">
              {(complaint.user.name ?? complaint.user.email ?? "Usuário").toString()}
            </div>
            {complaint.locationLabel ? (
              <div className="text-xs text-foreground/60 mt-2">{complaint.locationLabel}</div>
            ) : null}
            <div className="mt-4 text-sm leading-6">{complaint.description}</div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <div className="font-title font-bold text-lg">Linha do tempo</div>
              <div className="mt-4 space-y-3">
                {complaint.events.map((ev) => (
                  <div key={ev.id} className="text-sm">
                    <div className="text-xs text-foreground/60">
                      {new Date(ev.createdAt).toLocaleString("pt-BR")}
                    </div>
                    <div>{ev.message}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-6">
              <div className="font-title font-bold text-lg">Anexos</div>
              <div className="mt-4 space-y-3">
                {complaint.attachments.map((a) => (
                  <div key={a.id} className="text-sm">
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:text-highlight"
                    >
                      {a.filename}
                    </a>
                    <div className="text-xs text-foreground/60">{a.mimeType}</div>
                  </div>
                ))}
                {!complaint.attachments.length ? (
                  <div className="text-sm text-foreground/70">Nenhum anexo.</div>
                ) : null}
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <div className="font-title font-bold text-lg">Respostas da empresa</div>
            <div className="mt-4 space-y-4">
              {complaint.responses.map((r) => (
                <div key={r.id} className="rounded-xl border border-black/10 bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-foreground/60">
                      {(r.authorName ?? "Equipe").toString()}
                    </div>
                    <div className="text-xs text-foreground/50">
                      {new Date(r.createdAt).toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <div className="text-sm mt-2 whitespace-pre-wrap">{r.message}</div>
                  {r.attachments?.length ? (
                    <div className="mt-3 grid gap-2">
                      {r.attachments.map((a) => (
                        <a
                          key={a.id}
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-black/10 bg-muted px-3 py-2 text-sm hover:bg-muted/80 transition-colors"
                        >
                          {a.filename}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {!complaint.responses.length ? (
                <div className="text-sm text-foreground/70">Sem respostas até o momento.</div>
              ) : null}
            </div>
          </Card>

          <CompanyActions complaintId={complaint.id} />
        </div>
      </main>
    </div>
  );
}
