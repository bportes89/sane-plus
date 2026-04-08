"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";

type Action = "EDITED" | "HIDDEN" | "REQUESTED_PROOF" | "REMOVED" | "RESTORED";

export function ModerationForm(props: {
  complaintId: string;
  initialIssue: string;
  initialDescription: string;
}) {
  const [action, setAction] = useState<Action>("EDITED");
  const [issue, setIssue] = useState(props.initialIssue);
  const [description, setDescription] = useState(props.initialDescription);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const needsEdit = useMemo(() => action === "EDITED", [action]);

  async function submit() {
    setSending(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch("/api/moderation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          complaintId: props.complaintId,
          action,
          reason: reason.trim() || undefined,
          details: details.trim() || undefined,
          edited: needsEdit
            ? {
                issue: issue.trim() || undefined,
                description: description.trim() || undefined,
              }
            : undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(data?.error ?? "Falha ao salvar.");
        return;
      }
      setOk(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="font-title font-bold text-lg">Ação de Moderação</div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm">
          <div className="text-foreground/70 mb-1">Ação</div>
          <select
            className="w-full h-11 rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
            value={action}
            onChange={(e) => setAction(e.target.value as Action)}
          >
            <option value="EDITED">Editar</option>
            <option value="HIDDEN">Ocultar</option>
            <option value="REQUESTED_PROOF">Solicitar comprovação</option>
            <option value="REMOVED">Remover</option>
            <option value="RESTORED">Restaurar</option>
          </select>
        </label>

        <label className="text-sm">
          <div className="text-foreground/70 mb-1">Motivo</div>
          <Input
            placeholder="Ex.: dados pessoais, risco jurídico, linguagem ofensiva"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-3">
        <div className="text-sm text-foreground/70 mb-1">Detalhes</div>
        <textarea
          className="w-full min-h-28 rounded-xl border border-black/10 bg-white px-4 py-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
          placeholder="Contexto e justificativa objetiva (sem juridiquês)."
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
      </div>

      {needsEdit ? (
        <div className="mt-4 grid gap-3">
          <label className="text-sm">
            <div className="text-foreground/70 mb-1">Título</div>
            <Input value={issue} onChange={(e) => setIssue(e.target.value)} />
          </label>
          <label className="text-sm">
            <div className="text-foreground/70 mb-1">Descrição</div>
            <textarea
              className="w-full min-h-40 rounded-xl border border-black/10 bg-white px-4 py-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]">
          {error}
        </div>
      ) : null}
      {ok ? (
        <div className="mt-4 rounded-xl bg-[#ecfff2] px-4 py-3 text-sm text-[#0d6b2f]">
          Ação registrada com sucesso.
        </div>
      ) : null}

      <div className="mt-5 flex gap-3">
        <Button onClick={submit} disabled={sending}>
          {sending ? "Salvando..." : "Registrar ação"}
        </Button>
      </div>
    </Card>
  );
}

