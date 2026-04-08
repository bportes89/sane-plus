"use client";

import useSWR from "swr";
import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

type QueueItem = {
  id: string;
  status: string;
  priority: number;
  createdAt: string;
  suggestion: {
    id: string;
    provider: string;
    model: string | null;
    recommendedAction: string | null;
    score: number | null;
    explanation: { summary?: string } | null;
    response: { id: string; status: string; createdAt: string; company: { name: string } } | null;
    complaint: { id: string; issue: string; status: string; visibility: string; createdAt: string; company: { name: string } } | null;
  };
};

type Metrics = {
  windowDays: number;
  suggestions: number;
  feedback: { total: number; accepted: number; rejected: number; acceptanceRate: number };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function SupportAdminAiModerationQueueClient() {
  const { data, mutate } = useSWR<QueueItem[]>("/api/moderation/ai-queue?limit=40", fetcher, { refreshInterval: 15000 });
  const { data: metrics } = useSWR<Metrics>("/api/moderation/ai-metrics", fetcher, { refreshInterval: 60000 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/moderation/ai-queue/${id}/apply`, { method: "POST" });
      if (!res.ok) {
        const out = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(out?.error ?? "Falha ao aplicar.");
        return;
      }
      await mutate();
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/moderation/ai-queue/${id}/dismiss`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const out = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(out?.error ?? "Falha ao dispensar.");
        return;
      }
      await mutate();
    } finally {
      setBusyId(null);
    }
  }

  const acceptance = metrics?.feedback?.acceptanceRate ?? 0;

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-title font-bold text-lg">Moderação com IA</h2>
          <div className="text-sm text-foreground/70 mt-1">
            Sugestões para moderador confirmar. Aceite/rejeição alimenta métricas.
          </div>
        </div>
        {metrics ? (
          <div className="text-right text-xs text-foreground/60">
            <div>30d: {metrics.suggestions} sugestões</div>
            <div>
              Aceitação: {(acceptance * 100).toFixed(0)}% ({metrics.feedback.accepted}/{metrics.feedback.total})
            </div>
          </div>
        ) : null}
      </div>

      {error ? <div className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]">{error}</div> : null}

      <div className="grid gap-2">
        {data?.length ? (
          data.map((q) => {
            const c = q.suggestion.complaint;
            const r = q.suggestion.response;
            const label = q.suggestion.recommendedAction ?? "—";
            const score = q.suggestion.score == null ? null : Math.round(q.suggestion.score * 100);
            const title = c ? `${c.company.name} · ${c.issue}` : r ? `${r.company.name} · Resposta da empresa` : "Item";
            return (
              <Card key={q.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-title font-semibold truncate">{title}</div>
                    <div className="text-xs text-foreground/60 mt-1">
                      Sugestão: {label}
                      {score != null ? ` · score ${score}%` : ""}
                      {" · "}
                      {q.suggestion.provider}
                      {q.suggestion.model ? `:${q.suggestion.model}` : ""}
                    </div>
                    {q.suggestion.explanation?.summary ? (
                      <div className="text-sm text-foreground/70 mt-2">{q.suggestion.explanation.summary}</div>
                    ) : null}
                    {c ? (
                      <div className="mt-3 flex items-center gap-2">
                        <Link href={`/complaints/${c.id}`} className="text-sm text-primary hover:text-highlight">
                          Abrir reclamação
                        </Link>
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-foreground/60">{new Date(q.createdAt).toLocaleString("pt-BR")}</div>
                    <div className="mt-3 flex items-center gap-2 justify-end">
                      <Button size="sm" disabled={busyId === q.id} onClick={() => apply(q.id)}>
                        Confirmar
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busyId === q.id} onClick={() => dismiss(q.id)}>
                        Dispensar
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })
        ) : (
          <Card className="p-5">
            <div className="text-sm text-foreground/70">Sem sugestões pendentes.</div>
          </Card>
        )}
      </div>
    </section>
  );
}
