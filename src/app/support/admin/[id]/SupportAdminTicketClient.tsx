"use client";

import Link from "next/link";
import useSWR from "swr";
import { useMemo, useState } from "react";
import { Logo } from "@/components/Logo";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

type Sender = { id: string; name: string | null; email: string | null; role: string };
type Message = {
  id: string;
  body: string;
  originalBody: string | null;
  createdAt: string;
  sender: Sender | null;
  senderRole: string | null;
};

type Ticket = {
  id: string;
  subject: string;
  category: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  reopenCount: number;
  deviceModel: string | null;
  appVersion: string | null;
  user: { id: string; name: string | null; email: string | null };
  complaint: { id: string; issue: string } | null;
  messages: Message[];
  attachments: Array<{
    id: string;
    url: string;
    filename: string;
    mimeType: string;
    size: number;
    createdAt: string;
  }>;
  rating: { score: number; comment: string | null } | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const templates = [
  {
    key: "saudacao",
    label: "Saudação",
    text: "Olá, tudo bem? Obrigado por entrar em contato com o SANE+. Como posso ajudar hoje?",
  },
  {
    key: "acolhimento",
    label: "Acolhimento",
    text: "Entendo como isso pode ser frustrante. Vamos resolver isso juntos.",
  },
  {
    key: "pedir_info",
    label: "Pedir info",
    text: "Para te ajudar melhor, preciso de algumas informações: qual é o número da reclamação e o que aconteceu?",
  },
  {
    key: "orientacao_editar",
    label: "Orientar editar",
    text: "Você pode editar sua reclamação acessando: Menu → Minhas Reclamações → Selecionar Reclamação → Editar.",
  },
  {
    key: "encaminhar_moderacao",
    label: "Moderação",
    text: "Encaminhei sua solicitação para nossa equipe de moderação. Assim que houver uma atualização, você será notificado.",
  },
  {
    key: "agressivo",
    label: "Usuário agressivo",
    text: "Entendo sua frustração e estou aqui para ajudar. Para seguirmos, preciso que mantenhamos uma conversa respeitosa.",
  },
  {
    key: "crime",
    label: "Acusação de crime",
    text: "Para sua segurança jurídica, não podemos publicar acusações criminais sem comprovação. Você pode reformular focando no problema ocorrido.",
  },
  {
    key: "dados_terceiros",
    label: "Dados de terceiros",
    text: "Removemos informações pessoais para proteger sua privacidade e cumprir a LGPD. Sua reclamação continua ativa.",
  },
  {
    key: "remover_reclamacao",
    label: "Remover reclamação",
    text: "Claro, posso te ajudar com isso. Confirma que deseja remover a reclamação #XXXX?",
  },
  {
    key: "excluir_conta",
    label: "Excluir conta",
    text: "Podemos excluir sua conta e todos os seus dados conforme a LGPD. Confirma que deseja prosseguir?",
  },
  {
    key: "encerrar",
    label: "Encerramento",
    text: "Fico feliz em ajudar. Se precisar de algo mais, estamos aqui.",
  },
];

const statusLabel: Record<string, string> = {
  OPEN: "Aberto",
  PENDING_SUPPORT: "Aguardando suporte",
  PENDING_USER: "Aguardando usuário",
  ESCALATED_MODERATION: "Encaminhado",
  CLOSED: "Encerrado",
};

export function SupportAdminTicketClient(props: { ticketId: string }) {
  const { data, mutate } = useSWR<Ticket>(`/api/support/tickets/${props.ticketId}`, fetcher, {
    refreshInterval: 8000,
  });

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const header = useMemo(() => {
    if (!data) return "Chamado";
    return `${data.subject} • ${statusLabel[data.status] ?? data.status}`;
  }, [data]);

  function applyTemplate(text: string) {
    setMessage((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
  }

  async function sendMessage() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/tickets/${props.ticketId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const out = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(out?.error ?? "Falha ao enviar.");
        return;
      }
      setMessage("");
      await mutate();
    } finally {
      setSending(false);
    }
  }

  async function closeTicket() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/tickets/${props.ticketId}/close`, { method: "POST" });
      const out = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(out?.error ?? "Falha ao encerrar.");
        return;
      }
      await mutate();
    } finally {
      setSending(false);
    }
  }

  async function escalateToModeration() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/tickets/${props.ticketId}/escalate`, { method: "POST" });
      const out = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(out?.error ?? "Falha ao encaminhar.");
        return;
      }
      applyTemplate(
        "Encaminhei sua solicitação para nossa equipe de moderação. Assim que houver uma atualização, você será notificado.",
      );
      await mutate();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/support/admin" />
        <Link href="/support/admin" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-5xl mx-auto space-y-4">
          <div>
            <h1 className="font-title font-bold text-xl">{header}</h1>
            <div className="text-sm text-foreground/70 mt-1">
              Usuário: {(data?.user.name ?? data?.user.email ?? "—").toString()}
              {data?.deviceModel ? ` • ${data.deviceModel}` : ""}
              {data?.appVersion ? ` • v${data.appVersion}` : ""}
            </div>
            {data?.complaint ? (
              <div className="text-sm text-foreground/70 mt-1">
                Reclamação:{" "}
                <Link href={`/complaints/${data.complaint.id}`} className="text-primary hover:text-highlight">
                  {data.complaint.issue}
                </Link>
              </div>
            ) : null}
          </div>

          <Card className="p-5">
            <div className="space-y-3">
              {data?.messages?.length ? (
                data.messages.map((m) => (
                  <div key={m.id} className="rounded-2xl border border-black/5 bg-white px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-foreground/60">
                        {(m.sender?.name ?? m.sender?.email ?? m.senderRole ?? "Usuário").toString()}
                      </div>
                      <div className="text-xs text-foreground/50">
                        {new Date(m.createdAt).toLocaleString("pt-BR")}
                      </div>
                    </div>
                    <div className="text-sm mt-2 whitespace-pre-wrap">{m.body}</div>
                    {m.originalBody ? (
                      <div className="text-xs text-foreground/50 mt-2">
                        Conteúdo original foi ajustado para segurança/LGPD.
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="text-sm text-foreground/70">Carregando...</div>
              )}
            </div>
          </Card>

          {data?.attachments?.length ? (
            <Card className="p-5">
              <div className="font-title font-semibold">Anexos</div>
              <div className="mt-3 grid gap-2">
                {data.attachments.map((a) => (
                  <a
                    key={a.id}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl bg-white border border-black/10 px-4 py-3 text-sm hover:bg-muted transition-colors"
                  >
                    <div className="font-medium">{a.filename}</div>
                    <div className="text-xs text-foreground/60 mt-1">
                      {new Date(a.createdAt).toLocaleString("pt-BR")}
                    </div>
                  </a>
                ))}
              </div>
            </Card>
          ) : null}

          {data?.rating ? (
            <div className="rounded-xl bg-muted px-4 py-3 text-sm text-foreground/70">
              Avaliação do usuário: {data.rating.score}/5{data.rating.comment ? ` • ${data.rating.comment}` : ""}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]">{error}</div>
          ) : null}

          <Card className="p-6 space-y-3">
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="text-xs rounded-full bg-primary/10 text-primary px-3 py-1 font-title font-semibold hover:bg-primary/15"
                  onClick={() => applyTemplate(t.text)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <label className="text-sm block">
              <div className="text-foreground/70 mb-1">Resposta</div>
              <textarea
                className="w-full min-h-28 rounded-xl border border-black/10 bg-white px-4 py-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Não solicite CPF, RG, endereço completo, dados bancários ou fotos de documentos."
              />
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button disabled={sending || message.trim().length < 2} onClick={sendMessage}>
                {sending ? "Enviando..." : "Enviar resposta"}
              </Button>
              <Button
                variant="secondary"
                disabled={sending || data?.status === "CLOSED" || data?.status === "ESCALATED_MODERATION"}
                onClick={escalateToModeration}
              >
                Encaminhar para moderação
              </Button>
              <Button variant="secondary" disabled={sending || data?.status === "CLOSED"} onClick={closeTicket}>
                Encerrar chamado
              </Button>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
