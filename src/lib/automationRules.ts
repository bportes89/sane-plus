import type { PrismaClient } from "@/generated/prisma/client";
import {
  AutomationTrigger,
  DataAlertScope,
  DataAlertType,
  NotificationType,
  UserRole,
} from "@/generated/prisma/client";
import { queueEmail } from "@/lib/outbox";
import { queueWebhook } from "@/lib/webhooks";

type Primitive = string | number | boolean | null;

type ConditionOp = "eq" | "in" | "contains" | "exists" | "gt" | "lt";

type Condition =
  | {
      field: string;
      op: ConditionOp;
      value?: Primitive | Primitive[];
    }
  | { all: Condition[] }
  | { any: Condition[] };

type Action =
  | {
      type: "notify";
      target: "user" | "company" | "staff";
      title: string;
      message: string;
      actionUrl?: string | null;
      notificationType?: NotificationType;
      dedupeWithinHours?: number;
    }
  | {
      type: "dataAlert";
      scope: DataAlertScope;
      alertType: DataAlertType;
      title: string;
      message: string;
      severity?: string | null;
      fingerprint?: string | null;
    }
  | {
      type: "email";
      to?: string | null;
      toConfigKey?: string | null;
      subject: string;
      body: string;
    }
  | {
      type: "webhook";
      url?: string | null;
      urlConfigKey?: string | null;
      method?: string | null;
      headers?: Record<string, string> | null;
      body: string;
      dedupeWithinHours?: number;
    };

type RuleRow = {
  id: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  priority: number;
  conditions: unknown;
  actions: unknown;
};

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

function getPathValue(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function toStringOrEmpty(v: unknown) {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function evalCondition(ctx: unknown, cond: Condition): boolean {
  if ("all" in cond) return cond.all.every((c) => evalCondition(ctx, c));
  if ("any" in cond) return cond.any.some((c) => evalCondition(ctx, c));

  const actual = getPathValue(ctx, cond.field);
  const op = cond.op;
  const value = cond.value;

  if (op === "exists") return actual !== null && actual !== undefined && toStringOrEmpty(actual).trim() !== "";
  if (op === "contains") {
    const hay = toStringOrEmpty(actual).toLowerCase();
    const needle = toStringOrEmpty(value).toLowerCase();
    return !!needle && hay.includes(needle);
  }
  if (op === "eq") return actual === value;
  if (op === "in") {
    const arr = Array.isArray(value) ? value : [value as Primitive];
    return arr.some((v) => v === actual);
  }
  if (op === "gt" || op === "lt") {
    const a = typeof actual === "number" ? actual : Number(actual);
    const b = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return op === "gt" ? a > b : a < b;
  }
  return false;
}

function safeParseCondition(raw: unknown): Condition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r["all"])) {
    const items = (r["all"] as unknown[]).map(safeParseCondition).filter(Boolean) as Condition[];
    return { all: items };
  }
  if (Array.isArray(r["any"])) {
    const items = (r["any"] as unknown[]).map(safeParseCondition).filter(Boolean) as Condition[];
    return { any: items };
  }
  const field = typeof r["field"] === "string" ? r["field"] : "";
  const op = r["op"];
  if (!field || typeof op !== "string") return null;
  if (!["eq", "in", "contains", "exists", "gt", "lt"].includes(op)) return null;
  return { field, op: op as ConditionOp, value: r["value"] as Primitive | Primitive[] | undefined };
}

function safeParseActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) return [];
  const out: Action[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const type = it["type"];
    if (type === "notify") {
      const target = it["target"];
      const title = typeof it["title"] === "string" ? it["title"] : "";
      const message = typeof it["message"] === "string" ? it["message"] : "";
      if (!title || !message) continue;
      if (target !== "user" && target !== "company" && target !== "staff") continue;
      out.push({
        type: "notify",
        target,
        title,
        message,
        actionUrl: typeof it["actionUrl"] === "string" ? it["actionUrl"] : null,
        notificationType: (it["notificationType"] as NotificationType) ?? NotificationType.ALERT,
        dedupeWithinHours: typeof it["dedupeWithinHours"] === "number" ? it["dedupeWithinHours"] : undefined,
      });
      continue;
    }
    if (type === "dataAlert") {
      const scope = it["scope"] as DataAlertScope;
      const alertType = it["alertType"] as DataAlertType;
      const title = typeof it["title"] === "string" ? it["title"] : "";
      const message = typeof it["message"] === "string" ? it["message"] : "";
      if (!title || !message) continue;
      if (!Object.values(DataAlertScope).includes(scope)) continue;
      if (!Object.values(DataAlertType).includes(alertType)) continue;
      out.push({
        type: "dataAlert",
        scope,
        alertType,
        title,
        message,
        severity: typeof it["severity"] === "string" ? it["severity"] : null,
        fingerprint: typeof it["fingerprint"] === "string" ? it["fingerprint"] : null,
      });
      continue;
    }
    if (type === "email") {
      const subject = typeof it["subject"] === "string" ? it["subject"] : "";
      const body = typeof it["body"] === "string" ? it["body"] : "";
      if (!subject || !body) continue;
      out.push({
        type: "email",
        to: typeof it["to"] === "string" ? it["to"] : null,
        toConfigKey: typeof it["toConfigKey"] === "string" ? it["toConfigKey"] : null,
        subject,
        body,
      });
      continue;
    }
    if (type === "webhook") {
      const body = typeof it["body"] === "string" ? it["body"] : "";
      if (!body) continue;
      const headers =
        it["headers"] && typeof it["headers"] === "object" && !Array.isArray(it["headers"])
          ? (it["headers"] as Record<string, string>)
          : null;
      out.push({
        type: "webhook",
        url: typeof it["url"] === "string" ? it["url"] : null,
        urlConfigKey: typeof it["urlConfigKey"] === "string" ? it["urlConfigKey"] : null,
        method: typeof it["method"] === "string" ? it["method"] : null,
        headers,
        body,
        dedupeWithinHours: typeof it["dedupeWithinHours"] === "number" ? it["dedupeWithinHours"] : undefined,
      });
      continue;
    }
  }
  return out;
}

async function getSystemConfigString(prisma: PrismaClient, key: string) {
  const row = await prisma.systemConfig.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? null;
}

function parseList(raw: string | null) {
  if (!raw) return [];
  return raw
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20);
}

async function shouldDedupeNotification(prisma: PrismaClient, args: { userId: string; title: string; hours: number }) {
  const from = new Date(Date.now() - Math.max(1, args.hours) * 60 * 60 * 1000);
  const exists = await prisma.notification.findFirst({
    where: { userId: args.userId, title: args.title, createdAt: { gte: from } },
    select: { id: true },
  });
  return !!exists;
}

export async function applyAutomationRules(
  prisma: PrismaClient,
  args: {
    trigger: AutomationTrigger;
    actor: { id: string; role: UserRole } | null;
    context: Record<string, unknown>;
  },
) {
  const rules = await prisma.automationRule.findMany({
    where: { enabled: true, trigger: args.trigger },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: 80,
    select: { id: true, enabled: true, trigger: true, priority: true, conditions: true, actions: true },
  });

  if (!rules.length) return { applied: 0 };

  const baseCtx = {
    trigger: args.trigger,
    actor: args.actor,
    ...args.context,
  };

  let applied = 0;

  for (const r of rules as RuleRow[]) {
    const cond = safeParseCondition(r.conditions);
    if (cond && !evalCondition(baseCtx, cond)) continue;

    const actions = safeParseActions(r.actions);
    if (!actions.length) continue;

    let executed = 0;

    for (const a of actions) {
      if (a.type === "notify") {
        if (a.target === "staff") {
          const staff = await prisma.user.findMany({
            where: { role: { in: [UserRole.ADMIN, UserRole.MODERATOR, UserRole.LEGAL] }, notifyInApp: true },
            select: { id: true, role: true },
          });
          const ids = staff.filter((u) => isStaff(u.role)).map((u) => u.id);
          if (!ids.length) continue;
          await prisma.notification.createMany({
            data: ids.map((uid) => ({
              userId: uid,
              type: a.notificationType ?? NotificationType.ALERT,
              title: a.title.slice(0, 120),
              message: a.message.slice(0, 900),
              actionUrl: (a.actionUrl ?? null) as string | null,
            })),
          });
          executed += 1;
          continue;
        }

        if (a.target === "company") {
          const companyId = toStringOrEmpty((baseCtx as Record<string, unknown>)["companyId"]);
          if (!companyId) continue;
          const recipients = await prisma.user.findMany({
            where: { role: UserRole.COMPANY, companyId, notifyInApp: true },
            select: { id: true },
          });
          if (!recipients.length) continue;
          await prisma.notification.createMany({
            data: recipients.map((u) => ({
              userId: u.id,
              type: a.notificationType ?? NotificationType.ALERT,
              title: a.title.slice(0, 120),
              message: a.message.slice(0, 900),
              actionUrl: (a.actionUrl ?? null) as string | null,
            })),
          });
          executed += 1;
          continue;
        }

        const userId = toStringOrEmpty((baseCtx as Record<string, unknown>)["userId"]);
        if (!userId) continue;
        if (typeof a.dedupeWithinHours === "number" && a.dedupeWithinHours > 0) {
          const dup = await shouldDedupeNotification(prisma, { userId, title: a.title, hours: a.dedupeWithinHours });
          if (dup) continue;
        }
        await prisma.notification.create({
          data: {
            userId,
            type: a.notificationType ?? NotificationType.ALERT,
            title: a.title.slice(0, 120),
            message: a.message.slice(0, 900),
            actionUrl: (a.actionUrl ?? null) as string | null,
          },
        });
        executed += 1;
        continue;
      }

      if (a.type === "dataAlert") {
        const fingerprint =
          a.fingerprint?.trim() ||
          `rule:${r.id}:${args.trigger}:${toStringOrEmpty((baseCtx as Record<string, unknown>)["complaintId"]) || "n/a"}:${new Date()
            .toISOString()
            .slice(0, 10)}`;

        const companyId = toStringOrEmpty((baseCtx as Record<string, unknown>)["companyId"]) || null;
        const city = toStringOrEmpty((baseCtx as Record<string, unknown>)["city"]) || null;
        const state = toStringOrEmpty((baseCtx as Record<string, unknown>)["state"]) || null;

        await prisma.dataAlert.upsert({
          where: { fingerprint },
          create: {
            scope: a.scope,
            type: a.alertType,
            fingerprint,
            title: a.title.slice(0, 140),
            message: a.message.slice(0, 900),
            severity: a.severity ?? null,
            companyId,
            city,
            state,
            meta: { ruleId: r.id, ...baseCtx } as unknown as object,
          },
          update: {},
        });
        executed += 1;
        continue;
      }

      if (a.type === "email") {
        const toList = a.to ? [a.to] : a.toConfigKey ? parseList(await getSystemConfigString(prisma, a.toConfigKey)) : [];
        for (const to of toList) {
          await queueEmail({
            to,
            subject: a.subject.slice(0, 140),
            body: a.body.slice(0, 6000),
            complaintId: toStringOrEmpty((baseCtx as Record<string, unknown>)["complaintId"]) || null,
            meta: { trigger: args.trigger, ruleId: r.id },
          });
          executed += 1;
        }
        continue;
      }

      if (a.type === "webhook") {
        const urlList = a.url ? [a.url] : a.urlConfigKey ? parseList(await getSystemConfigString(prisma, a.urlConfigKey)) : [];
        const hours = typeof a.dedupeWithinHours === "number" ? a.dedupeWithinHours : null;

        for (const url of urlList) {
          if (hours && hours > 0) {
            const from = new Date(Date.now() - hours * 60 * 60 * 1000);
            const exists = await prisma.webhookOutbox.findFirst({
              where: { url, createdAt: { gte: from }, body: a.body },
              select: { id: true },
            });
            if (exists) continue;
          }
          await queueWebhook({
            url,
            method: a.method ?? "POST",
            headers: a.headers ?? undefined,
            body: a.body,
            meta: { trigger: args.trigger, ruleId: r.id },
          });
          executed += 1;
        }
        continue;
      }
    }

    if (executed > 0) {
      await prisma.automationRule.update({ where: { id: r.id }, data: { lastRunAt: new Date() } });
      applied += 1;
    }
  }

  return { applied };
}
