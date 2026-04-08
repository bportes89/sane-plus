"use client";

import useSWR from "swr";
import { useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

type OutboxItem = {
  id: string;
  to: string;
  subject: string;
  status: string;
  error?: string | null;
  createdAt: string;
  sentAt: string | null;
  ticketId: string | null;
  complaintId: string | null;
  userId: string | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function SupportAdminOutboxClient() {
  const { data, mutate } = useSWR<OutboxItem[]>("/api/outbox", fetcher, {
    refreshInterval: 15000,
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function processOutbox() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/outbox/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 20 }),
      });
      const out = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(out?.error ?? "Falha ao processar.");
        return;
      }
      await mutate();
    } finally {
      setSending(false);
    }
  }

  async function retryItem(id: string) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/outbox/${id}/retry`, { method: "POST" });
      if (!res.ok) {
        setError("Falha ao reprocessar.");
        return;
      }
      await mutate();
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-title font-bold text-lg">Outbox de e-mails</h2>
        <Button variant="secondary" disabled={sending} onClick={processOutbox}>
          {sending ? "Processando..." : "Processar outbox"}
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]">{error}</div>
      ) : null}

      <div className="grid gap-2">
        {data?.length ? (
          data.map((m) => (
            <Card key={m.id} className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-title font-semibold">{m.subject}</div>
                  <div className="text-xs text-foreground/60 mt-1">{m.to}</div>
                  {m.status === "FAILED" && m.error ? (
                    <div className="text-xs text-[#8a1f1f] mt-1">Erro: {m.error}</div>
                  ) : null}
                </div>
                <div className="text-right text-xs text-foreground/60">
                  <div>{new Date(m.createdAt).toLocaleString("pt-BR")}</div>
                  <div>{m.status}</div>
                  {m.status === "FAILED" ? (
                    <div className="mt-2">
                      <Button size="sm" variant="secondary" disabled={sending} onClick={() => retryItem(m.id)}>
                        Reprocessar
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          ))
        ) : (
          <Card className="p-5">
            <div className="text-sm text-foreground/70">Sem itens.</div>
          </Card>
        )}
      </div>
    </section>
  );
}
