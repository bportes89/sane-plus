"use client";

import Link from "next/link";
import useSWR from "swr";
import { useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/Logo";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";

type SupportTicketCategory =
  | "GENERAL"
  | "COMPLAINT"
  | "CONTESTATION"
  | "TECHNICAL"
  | "ACCOUNT"
  | "MODERATION";

type Ticket = {
  id: string;
  subject: string;
  category: SupportTicketCategory;
  status: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  reopenCount: number;
};

type FAQItem = { slug: string; title: string; body: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const categoryLabel: Record<string, string> = {
  GENERAL: "Dúvida geral",
  COMPLAINT: "Problema com reclamação",
  CONTESTATION: "Contestação de resposta",
  TECHNICAL: "Problema técnico",
  ACCOUNT: "Cadastro/conta",
  MODERATION: "Moderação/Conteúdo",
};

const statusLabel: Record<string, string> = {
  OPEN: "Aberto",
  PENDING_SUPPORT: "Aguardando suporte",
  PENDING_USER: "Aguardando usuário",
  ESCALATED_MODERATION: "Encaminhado",
  CLOSED: "Encerrado",
};

const categories: SupportTicketCategory[] = [
  "GENERAL",
  "COMPLAINT",
  "CONTESTATION",
  "TECHNICAL",
  "ACCOUNT",
  "MODERATION",
];

export default function SupportChatPage() {
  const { data, mutate } = useSWR<Ticket[]>("/api/support/tickets", fetcher);

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<SupportTicketCategory>("GENERAL");
  const [complaintId, setComplaintId] = useState("");
  const [deviceModel, setDeviceModel] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const faqQuery = useMemo(() => message.trim().slice(0, 80), [message]);
  const { data: faq } = useSWR<FAQItem[]>(
    faqQuery.length >= 10 ? `/api/support/faq?q=${encodeURIComponent(faqQuery)}` : null,
    fetcher,
  );

  useEffect(() => {
    if (category !== "TECHNICAL") {
      setDeviceModel("");
      setAppVersion("");
    }
    if (
      category !== "COMPLAINT" &&
      category !== "CONTESTATION" &&
      category !== "MODERATION"
    ) {
      setComplaintId("");
    }
  }, [category]);

  async function createTicket() {
    setSending(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject,
          message,
          category,
          complaintId: complaintId.trim() || undefined,
          deviceModel: deviceModel.trim() || undefined,
          appVersion: appVersion.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Não foi possível abrir o chamado.");
        return;
      }
      const out = (await res.json().catch(() => null)) as { id?: string } | null;
      setOk("Chamado aberto. Você pode acompanhar e responder por aqui.");
      setSubject("");
      setMessage("");
      setCategory("GENERAL");
      setComplaintId("");
      await mutate();
      if (out?.id) window.location.href = `/support/chat/${out.id}`;
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo />
        <Link href="/support" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="font-title font-bold text-2xl">Chat / Chamados</h1>
            <div className="text-sm text-foreground/70 mt-1">
              “Olá, tudo bem? Obrigado por entrar em contato com o SANE+. Como posso ajudar hoje?”
            </div>
          </div>

          <Card className="p-6 space-y-3">
            <div className="font-title font-bold text-lg">Abrir novo chamado</div>
            <label className="text-sm block">
              <div className="text-foreground/70 mb-1">Categoria</div>
              <select
                className="h-11 w-full rounded-xl border border-black/10 bg-white px-4 text-base outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                value={category}
                onChange={(e) => setCategory(e.target.value as SupportTicketCategory)}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel[c] ?? c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm block">
              <div className="text-foreground/70 mb-1">Assunto</div>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ex.: Não consigo enviar anexo / Dúvida sobre status"
              />
            </label>
            <label className="text-sm block">
              <div className="text-foreground/70 mb-1">Mensagem</div>
              <textarea
                className="w-full min-h-28 rounded-xl border border-black/10 bg-white px-4 py-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Descreva o que aconteceu. Não envie CPF, RG, endereço completo ou dados bancários."
              />
            </label>

            {category === "COMPLAINT" ||
            category === "CONTESTATION" ||
            category === "MODERATION" ? (
              <label className="text-sm block">
                <div className="text-foreground/70 mb-1">Número/ID da reclamação (opcional)</div>
                <Input
                  value={complaintId}
                  onChange={(e) => setComplaintId(e.target.value)}
                  placeholder="Cole aqui o ID da reclamação (ex.: ck... / cuid)"
                />
              </label>
            ) : null}

            {category === "TECHNICAL" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-sm block">
                  <div className="text-foreground/70 mb-1">Modelo do celular (opcional)</div>
                  <Input
                    value={deviceModel}
                    onChange={(e) => setDeviceModel(e.target.value)}
                    placeholder="Ex.: iPhone 13 / Galaxy A54"
                  />
                </label>
                <label className="text-sm block">
                  <div className="text-foreground/70 mb-1">Versão do app (opcional)</div>
                  <Input
                    value={appVersion}
                    onChange={(e) => setAppVersion(e.target.value)}
                    placeholder="Ex.: 0.1.0"
                  />
                </label>
              </div>
            ) : null}

            {faq?.length ? (
              <div className="rounded-xl bg-muted px-4 py-3">
                <div className="text-xs text-foreground/60">Talvez isso ajude (FAQ):</div>
                <div className="mt-2 grid gap-2">
                  {faq.slice(0, 3).map((i) => (
                    <Link
                      key={i.slug}
                      href={`/support/faq/${i.slug}`}
                      className="text-sm text-primary hover:text-highlight"
                    >
                      {i.title}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}

            {error && ok === null ? (
              <div className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]">
                {error}
              </div>
            ) : null}
            {ok ? (
              <div className="rounded-xl bg-[#ecfff2] px-4 py-3 text-sm text-[#0d6b2f]">
                {ok}
              </div>
            ) : null}

            <Button disabled={sending || subject.trim().length < 4 || message.trim().length < 5} onClick={createTicket}>
              {sending ? "Enviando..." : "Abrir chamado"}
            </Button>
          </Card>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-title font-bold text-lg">Meus chamados</h2>
              <Link href="/support/faq" className="text-sm text-primary hover:text-highlight">
                Abrir FAQ
              </Link>
            </div>
            <div className="grid gap-2">
              {data?.length ? (
                data.map((t) => (
                  <Link key={t.id} href={`/support/chat/${t.id}`} className="block">
                    <Card className="p-5 hover:bg-muted transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-title font-semibold">{t.subject}</div>
                          <div className="text-xs text-foreground/60 mt-1">
                            {categoryLabel[t.category] ?? t.category}
                          </div>
                        </div>
                        <div className="text-right text-xs text-foreground/60">
                          <div>{new Date(t.updatedAt).toLocaleString("pt-BR")}</div>
                          <div>{statusLabel[t.status] ?? t.status}</div>
                        </div>
                      </div>
                    </Card>
                  </Link>
                ))
              ) : (
                <Card className="p-5">
                  <div className="text-sm text-foreground/70">Você ainda não abriu nenhum chamado.</div>
                </Card>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
