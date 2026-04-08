import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { UserRole } from "@/generated/prisma/client";
import { ModerationForm } from "./ModerationForm";

export default async function ModerationCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const allowedRoles: UserRole[] = [UserRole.MODERATOR, UserRole.LEGAL, UserRole.ADMIN];
  if (!allowedRoles.includes(user.role)) redirect("/home");

  const { id } = await params;
  const complaint = await prisma.complaint.findUnique({
    where: { id },
    include: {
      company: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
      events: { orderBy: { createdAt: "asc" } },
      responses: { orderBy: { createdAt: "asc" } },
      contestations: { orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "desc" } },
      moderation: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });

  if (!complaint) {
    return (
      <div className="min-h-dvh bg-background px-6 py-8">
        <div className="w-full max-w-4xl mx-auto">
          <div className="font-title font-bold text-2xl">Caso não encontrado</div>
          <div className="mt-4">
            <Link href="/moderation" className="text-sm text-primary hover:text-highlight">
              Voltar à fila
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/home" />
        <Link href="/moderation" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="font-title font-bold text-2xl">Revisão de Caso</h1>
            <div className="text-sm text-foreground/70 mt-1">
              Status: <span className="text-foreground">{complaint.status}</span> •{" "}
              Visibilidade:{" "}
              <span className="text-foreground">{complaint.visibility}</span>
            </div>
          </div>

          <Card className="p-6">
            <div className="font-title font-semibold text-lg">{complaint.issue}</div>
            <div className="text-sm text-foreground/70 mt-1">
              {complaint.company.name} •{" "}
              {(complaint.user.name ?? complaint.user.email ?? "Usuário").toString()}
            </div>
            <div className="mt-4 text-sm leading-6">{complaint.description}</div>
            <div className="mt-4 text-xs text-foreground/60">
              Criada em {new Date(complaint.createdAt).toLocaleString("pt-BR")}
            </div>
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
                {!complaint.events.length ? (
                  <div className="text-sm text-foreground/70">Sem eventos.</div>
                ) : null}
              </div>
            </Card>

            <Card className="p-6">
              <div className="font-title font-bold text-lg">Contestação / Respostas</div>
              <div className="mt-4 space-y-3">
                {complaint.responses.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-xl bg-[#eef7ff] border border-black/10 px-4 py-3 text-sm"
                  >
                    <div className="text-xs text-foreground/60">
                      {new Date(r.createdAt).toLocaleString("pt-BR")} • {r.status}
                    </div>
                    <div className="mt-1">{r.message}</div>
                  </div>
                ))}
                {complaint.contestations.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl bg-[#fff7e6] border border-black/10 px-4 py-3 text-sm"
                  >
                    <div className="text-xs text-foreground/60">
                      {new Date(c.createdAt).toLocaleString("pt-BR")}
                    </div>
                    <div className="mt-1">{c.message}</div>
                  </div>
                ))}
                {!complaint.responses.length && !complaint.contestations.length ? (
                  <div className="text-sm text-foreground/70">Sem registros.</div>
                ) : null}
              </div>
            </Card>
          </div>

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

          <ModerationForm
            complaintId={complaint.id}
            initialIssue={complaint.issue}
            initialDescription={complaint.description}
          />

          <Card className="p-6">
            <div className="font-title font-bold text-lg">Histórico de moderação</div>
            <div className="mt-4 space-y-3">
              {complaint.moderation.map((m) => (
                <div key={m.id} className="text-sm">
                  <div className="text-xs text-foreground/60">
                    {new Date(m.createdAt).toLocaleString("pt-BR")} • {m.action} •{" "}
                    {m.moderatorId ? "Humano" : "Automático"}
                  </div>
                  <div className="text-foreground/80">
                    {m.reason ? `Motivo: ${m.reason}` : "Sem motivo informado"}
                  </div>
                </div>
              ))}
              {!complaint.moderation.length ? (
                <div className="text-sm text-foreground/70">
                  Nenhuma ação registrada.
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
