import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { UserRole } from "@/generated/prisma/client";
import { SupportAdminMetricsClient } from "./SupportAdminMetricsClient";
import { SupportAdminOutboxClient } from "./SupportAdminOutboxClient";
import { SupportAdminWebhookOutboxClient } from "./SupportAdminWebhookOutboxClient";
import { SupportAdminAiModerationQueueClient } from "./SupportAdminAiModerationQueueClient";
import { Button } from "@/components/Button";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export default async function SupportAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/home");

  const tickets = await prisma.supportTicket.findMany({
    orderBy: { updatedAt: "desc" },
    take: 80,
    select: {
      id: true,
      subject: true,
      category: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      firstStaffReplyAt: true,
      closedAt: true,
      reopenCount: true,
      user: { select: { name: true, email: true } },
    },
  });

  const statusLabel: Record<string, string> = {
    OPEN: "Aberto",
    PENDING_SUPPORT: "Aguardando suporte",
    PENDING_USER: "Aguardando usuário",
    ESCALATED_MODERATION: "Encaminhado",
    CLOSED: "Encerrado",
  };

  const emailTemplates = [
    {
      subject: "Recebemos sua solicitação",
      body: "Olá, recebemos sua mensagem e estamos analisando. Em breve retornamos.",
    },
    {
      subject: "Sua solicitação foi concluída",
      body: "Olá, sua solicitação foi resolvida. Se precisar de algo mais, estamos à disposição.",
    },
    {
      subject: "Precisamos de mais detalhes",
      body: "Para continuar sua análise, precisamos de mais informações sobre o caso.",
    },
  ];

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/support" />
        <Link href="/support" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="font-title font-bold text-2xl">Painel do Suporte</h1>
            <div className="text-sm text-foreground/70 mt-1">
              Padrão: empático, claro, neutro, transparente, ágil e seguro.
            </div>
          </div>

          <SupportAdminMetricsClient />
          <SupportAdminAiModerationQueueClient />

          <section className="space-y-3">
            <h2 className="font-title font-bold text-lg">Automações</h2>
            <Card className="p-5">
              <div className="text-sm text-foreground/70">
                Regras configuráveis para disparar alertas, notificações e integrações (e-mail/webhook).
              </div>
              <div className="mt-3">
                <Link href="/support/admin/automations">
                  <Button>Gerenciar regras</Button>
                </Link>
              </div>
            </Card>
          </section>

          <section className="space-y-3">
            <h2 className="font-title font-bold text-lg">SLA</h2>
            <Card className="p-5">
              <div className="text-sm text-foreground/70">
                Processa alertas de SLA (1ª resposta em 48h) e lembretes/encerramentos por inatividade.
              </div>
              <form
                action="/api/support/slas/process"
                method="post"
                className="mt-3"
              >
                <Button type="submit">Processar SLAs</Button>
              </form>
            </Card>
          </section>

          <section className="space-y-3">
            <h2 className="font-title font-bold text-lg">Templates de e-mail</h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {emailTemplates.map((t) => (
                <Card key={t.subject} className="p-5">
                  <div className="text-xs text-foreground/60">Assunto</div>
                  <div className="font-title font-semibold mt-1">{t.subject}</div>
                  <div className="text-xs text-foreground/60 mt-3">Corpo</div>
                  <div className="text-sm text-foreground/70 mt-1 whitespace-pre-wrap">{t.body}</div>
                </Card>
              ))}
            </div>
          </section>

          <SupportAdminOutboxClient />
          <SupportAdminWebhookOutboxClient />

          <section className="space-y-3">
            <h2 className="font-title font-bold text-lg">Fila</h2>
            <div className="grid gap-2">
              {tickets.map((t) => (
                <Link key={t.id} href={`/support/admin/${t.id}`} className="block">
                  <Card className="p-5 hover:bg-muted transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-title font-semibold">{t.subject}</div>
                        <div className="text-xs text-foreground/60 mt-1">
                          {(t.user.name ?? t.user.email ?? "Usuário").toString()}
                        </div>
                      </div>
                      <div className="text-right text-xs text-foreground/60">
                        <div>{new Date(t.updatedAt).toLocaleString("pt-BR")}</div>
                        <div>{statusLabel[t.status] ?? t.status}</div>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
              {!tickets.length ? (
                <Card className="p-5">
                  <div className="text-sm text-foreground/70">Nenhum chamado.</div>
                </Card>
              ) : null}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
