"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import type { AutomationTrigger } from "@/generated/prisma/client";

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  priority: number;
  conditions: unknown;
  actions: unknown;
  lastRunAt: string | null;
  updatedAt: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function prettyJson(v: unknown) {
  return JSON.stringify(v ?? {}, null, 2);
}

export function SupportAdminAutomationsClient() {
  const { data, mutate } = useSWR<Rule[]>("/api/automation-rules", fetcher, { refreshInterval: 15000 });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("Alerta staff: urgência crítica");
  const [newTrigger, setNewTrigger] = useState<AutomationTrigger>("COMPLAINT_CREATED");
  const [newPriority, setNewPriority] = useState(50);
  const [newConditions, setNewConditions] = useState(prettyJson({ field: "urgency", op: "eq", value: "critical" }));
  const [newActions, setNewActions] = useState(
    prettyJson([
      {
        type: "notify",
        target: "staff",
        title: "Caso crítico (regra)",
        message: "Reclamação marcada como crítica por regra configurável.",
        actionUrl: "/alerts",
        dedupeWithinHours: 6,
      },
    ]),
  );

  const triggers = useMemo(
    () => ["COMPLAINT_CREATED", "COMPANY_REPLIED", "COMPLAINT_RESOLVED", "COMPLAINT_SLA_CHECK", "REPORT_GENERATED"] as const,
    [],
  );

  async function createRule() {
    setCreating(true);
    setError(null);
    try {
      const conditions = JSON.parse(newConditions);
      const actions = JSON.parse(newActions);
      const res = await fetch("/api/automation-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newName,
          trigger: newTrigger,
          priority: newPriority,
          enabled: true,
          conditions,
          actions,
        }),
      });
      const out = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(out?.error ?? "Falha ao criar regra.");
        return;
      }
      await mutate();
    } catch {
      setError("JSON inválido em conditions/actions.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleRule(r: Rule) {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/automation-rules/${r.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !r.enabled }),
      });
      if (!res.ok) {
        setError("Falha ao atualizar.");
        return;
      }
      await mutate();
    } finally {
      setCreating(false);
    }
  }

  async function deleteRule(id: string) {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/automation-rules/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Falha ao remover.");
        return;
      }
      await mutate();
    } finally {
      setCreating(false);
    }
  }

  async function saveRule(r: Rule, patch: Partial<Pick<Rule, "name" | "priority" | "conditions" | "actions">>) {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/automation-rules/${r.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setError("Falha ao salvar.");
        return;
      }
      await mutate();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]">{error}</div> : null}

      <Card className="p-5">
        <div className="font-title font-bold text-lg">Criar regra</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4">
          <div>
            <div className="text-xs text-foreground/60">Nome</div>
            <input
              className="mt-1 w-full rounded-xl border border-black/10 bg-background px-3 py-2 text-sm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div>
            <div className="text-xs text-foreground/60">Gatilho</div>
            <select
              className="mt-1 w-full rounded-xl border border-black/10 bg-background px-3 py-2 text-sm"
              value={newTrigger}
              onChange={(e) => setNewTrigger(e.target.value as AutomationTrigger)}
            >
              {triggers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs text-foreground/60">Prioridade</div>
            <input
              className="mt-1 w-full rounded-xl border border-black/10 bg-background px-3 py-2 text-sm"
              type="number"
              value={newPriority}
              onChange={(e) => setNewPriority(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
          <div>
            <div className="text-xs text-foreground/60">Conditions (JSON)</div>
            <textarea
              className="mt-1 w-full min-h-[180px] rounded-xl border border-black/10 bg-background px-3 py-2 text-xs font-mono"
              value={newConditions}
              onChange={(e) => setNewConditions(e.target.value)}
            />
          </div>
          <div>
            <div className="text-xs text-foreground/60">Actions (JSON array)</div>
            <textarea
              className="mt-1 w-full min-h-[180px] rounded-xl border border-black/10 bg-background px-3 py-2 text-xs font-mono"
              value={newActions}
              onChange={(e) => setNewActions(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4">
          <Button disabled={creating} onClick={createRule}>
            {creating ? "Salvando..." : "Criar"}
          </Button>
        </div>
      </Card>

      <div className="grid gap-2">
        {data?.length ? (
          data.map((r) => <RuleCard key={r.id} r={r} disabled={creating} onToggle={toggleRule} onDelete={deleteRule} onSave={saveRule} />)
        ) : (
          <Card className="p-5">
            <div className="text-sm text-foreground/70">Nenhuma regra criada.</div>
          </Card>
        )}
      </div>
    </div>
  );
}

function RuleCard(props: {
  r: Rule;
  disabled: boolean;
  onToggle: (r: Rule) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSave: (r: Rule, patch: Partial<Pick<Rule, "name" | "priority" | "conditions" | "actions">>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(props.r.name);
  const [priority, setPriority] = useState(props.r.priority);
  const [conditions, setConditions] = useState(prettyJson(props.r.conditions));
  const [actions, setActions] = useState(prettyJson(props.r.actions));

  async function save() {
    const c = JSON.parse(conditions);
    const a = JSON.parse(actions);
    await props.onSave(props.r, { name, priority, conditions: c, actions: a });
    setEditing(false);
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-title font-semibold truncate">{props.r.name}</div>
          <div className="text-xs text-foreground/60 mt-1">
            {props.r.trigger} • prioridade {props.r.priority} • {props.r.enabled ? "ATIVA" : "INATIVA"}
          </div>
          {props.r.lastRunAt ? <div className="text-xs text-foreground/60 mt-1">Última execução: {new Date(props.r.lastRunAt).toLocaleString("pt-BR")}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={props.disabled} onClick={() => props.onToggle(props.r)}>
            {props.r.enabled ? "Desativar" : "Ativar"}
          </Button>
          <Button size="sm" variant="secondary" disabled={props.disabled} onClick={() => setEditing((v) => !v)}>
            {editing ? "Fechar" : "Editar"}
          </Button>
          <Button size="sm" variant="secondary" disabled={props.disabled} onClick={() => props.onDelete(props.r.id)}>
            Remover
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
          <div>
            <div className="text-xs text-foreground/60">Nome</div>
            <input
              className="mt-1 w-full rounded-xl border border-black/10 bg-background px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="text-xs text-foreground/60 mt-3">Prioridade</div>
            <input
              className="mt-1 w-full rounded-xl border border-black/10 bg-background px-3 py-2 text-sm"
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
            <div className="text-xs text-foreground/60 mt-3">Conditions (JSON)</div>
            <textarea
              className="mt-1 w-full min-h-[160px] rounded-xl border border-black/10 bg-background px-3 py-2 text-xs font-mono"
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
            />
          </div>
          <div>
            <div className="text-xs text-foreground/60">Actions (JSON array)</div>
            <textarea
              className="mt-1 w-full min-h-[260px] rounded-xl border border-black/10 bg-background px-3 py-2 text-xs font-mono"
              value={actions}
              onChange={(e) => setActions(e.target.value)}
            />
            <div className="mt-3">
              <Button size="sm" disabled={props.disabled} onClick={save}>
                Salvar
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
