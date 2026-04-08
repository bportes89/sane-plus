"use client";

import Link from "next/link";
import useSWR from "swr";
import { use, useMemo, useState } from "react";
import { Logo } from "@/components/Logo";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

type Sender = { id: string; name: string | null; email: string | null; role: string };
type Message = {
  id: string;
  body: string;
  originalBody: string | null;
  flags: unknown;
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
  userId: string;
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

const statusLabel: Record<string, string> = {
  OPEN: "Aberto",
  PENDING_SUPPORT: "Aguardando suporte",
  PENDING_USER: "Aguardando você",
  ESCALATED_MODERATION: "Encaminhado",
  CLOSED: "Encerrado",
};

type Flags = {
  pii?: boolean;
  profanity?: boolean;
  employeeName?: boolean;
  crimeAccusation?: boolean;
  hatefulOrSexual?: boolean;
  sensitiveData?: boolean;
};

function flagsToText(flags: unknown) {
  const f = (flags ?? null) as Flags | null;
  if (!f) return [];
  const items: string[] = [];
  if (f.pii) items.push("Dados pessoais");
  if (f.employeeName) items.push("Nome de pessoa/funcionário");
  if (f.profanity) items.push("Ofensa/palavrão");
  if (f.crimeAccusation) items.push("Acusação criminal");
  if (f.sensitiveData) items.push("Dado sensível");
  if (f.hatefulOrSexual) items.push("Conteúdo sexual/discriminatório");
  return items;
}

export default function TicketChatPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const ticketId = (params as unknown as { then?: unknown })?.then
    ? use(params as Promise<{ id: string }>).id
    : (params as { id: string }).id;
  const { data, mutate } = useSWR<Ticket>(
    ticketId ? `/api/support/tickets/${ticketId}` : null,
    fetcher,
    { refreshInterval: 8000 },
  );

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingComment, setRatingComment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const header = useMemo(() => {
    if (!data) return null;
    return `${data.subject} • ${statusLabel[data.status] ?? data.status}`;
  }, [data]);

  async function sendMessage() {
    setSending(true);
    setError(null);
    setWarn(null);
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const out = (await res.json().catch(() => null)) as
        | { error?: string; moderation?: unknown }
        | null;
      if (!res.ok) {
        setError(out?.error ?? "Falha ao enviar mensagem.");
        return;
      }
      const issues = flagsToText(out?.moderation);
      if (issues.length) {
        setWarn(`Ajustamos sua mensagem para segurança/LGPD: ${issues.join(", ")}.`);
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
      const res = await fetch(`/api/support/tickets/${ticketId}/close`, { method: "POST" });
      if (!res.ok) {
        const out = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(out?.error ?? "Falha ao encerrar.");
        return;
      }
      await mutate();
    } finally {
      setSending(false);
    }
  }

  async function rateTicket() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/rate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ score: ratingScore, comment: ratingComment }),
      });
      if (!res.ok) {
        const out = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(out?.error ?? "Falha ao enviar avaliação.");
        return;
      }
      await mutate();
    } finally {
      setSending(false);
    }
  }

  async function uploadAttachment() {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/support/tickets/${ticketId}/attachments`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const out = (await res.json().catch(() => null)) as { error?: string } | null;
        setUploadError(out?.error ?? "Falha ao enviar arquivo.");
        return;
      }
      setFile(null);
      await mutate();
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo />
        <Link href="/support/chat" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-4xl mx-auto space-y-4">
          <div>
            <h1 className="font-title font-bold text-xl">{header ?? "Chamado"}</h1>
            {data?.complaint ? (
              <div className="text-sm text-foreground/70 mt-1">
                Reclamação vinculada:{" "}
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
                        Versão original foi ajustada para segurança/LGPD.
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="text-sm text-foreground/70">Carregando mensagens...</div>
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

          {warn ? (
            <div className="rounded-xl bg-muted px-4 py-3 text-sm text-foreground/70" role="status" aria-live="polite">
              {warn}
            </div>
          ) : null}

          {error ? (
            <div
              className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]"
              role="alert"
              aria-live="assertive"
            >
              {error}
            </div>
          ) : null}

          {uploadError ? (
            <div
              className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]"
              role="alert"
              aria-live="assertive"
            >
              {uploadError}
            </div>
          ) : null}

          {data?.status === "CLOSED" ? (
            <Card className="p-6 space-y-3">
              <div className="font-title font-bold text-lg">Avaliar atendimento</div>
              {data.rating ? (
                <div className="text-sm text-foreground/70">
                  Sua avaliação: {data.rating.score}/5
                  {data.rating.comment ? ` • ${data.rating.comment}` : ""}
                </div>
              ) : (
                <>
                  <label className="text-sm block">
                    <div className="text-foreground/70 mb-1">Nota</div>
                    <select
                      className="h-11 w-full rounded-xl border border-black/10 bg-white px-4 text-base outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                      value={ratingScore}
                      onChange={(e) => setRatingScore(Number(e.target.value))}
                    >
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm block">
                    <div className="text-foreground/70 mb-1">Comentário (opcional)</div>
                    <textarea
                      className="w-full min-h-24 rounded-xl border border-black/10 bg-white px-4 py-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                      value={ratingComment}
                      onChange={(e) => setRatingComment(e.target.value)}
                      placeholder="Conte como foi o atendimento."
                    />
                  </label>
                  <Button disabled={sending} onClick={rateTicket}>
                    {sending ? "Enviando..." : "Enviar avaliação"}
                  </Button>
                </>
              )}
            </Card>
          ) : (
            <Card className="p-6 space-y-3">
              <div className="text-sm text-foreground/70">
                Você pode anexar prints (PNG/JPG/WebP) ou PDF. Não envie documentos pessoais.
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="file"
                  aria-label="Selecionar anexo"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="text-sm"
                />
                <Button disabled={uploading || !file} onClick={uploadAttachment} variant="secondary">
                  {uploading ? "Enviando..." : "Enviar anexo"}
                </Button>
              </div>
              <label className="text-sm block">
                <div className="text-foreground/70 mb-1">Sua mensagem</div>
                <textarea
                  className="w-full min-h-24 rounded-xl border border-black/10 bg-white px-4 py-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Escreva de forma clara e respeitosa. Não envie dados sensíveis."
                />
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button disabled={sending || message.trim().length < 2} onClick={sendMessage}>
                  {sending ? "Enviando..." : "Enviar"}
                </Button>
                <Button variant="secondary" disabled={sending} onClick={closeTicket}>
                  Encerrar chamado
                </Button>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
