import { prisma } from "@/lib/prisma";
import { WebhookStatus } from "@/generated/prisma/client";

export async function queueWebhook(args: {
  url: string | null | undefined;
  method?: string | null;
  headers?: Record<string, string> | null;
  body: string;
  integrationId?: string | null;
  meta?: Record<string, unknown>;
}) {
  const url = String(args.url ?? "").trim();
  if (!url) return null;

  const item = await prisma.webhookOutbox.create({
    data: {
      url,
      method: (args.method ?? "POST").toUpperCase(),
      headers: args.headers ? (args.headers as unknown as object) : undefined,
      body: args.body,
      status: WebhookStatus.PENDING,
      integrationId: args.integrationId ?? null,
      meta: args.meta ? (args.meta as unknown as object) : undefined,
    },
    select: { id: true },
  });
  return item.id;
}

export async function sendWebhookUsingProvider(args: {
  url: string;
  method: string;
  headers?: Record<string, string> | null;
  body: string;
}) {
  const enabled = process.env.WEBHOOK_DELIVERY_ENABLED === "true";
  if (!enabled) return { ok: true as const, provider: "simulated" as const, status: 200 };

  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Math.min(20000, Number(process.env.WEBHOOK_TIMEOUT_MS ?? 8000)));
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(args.url, {
      method: args.method,
      headers: { "content-type": "application/json", ...(args.headers ?? {}) },
      body: args.body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "Erro ao enviar webhook");
      return { ok: false as const, provider: "fetch" as const, status: res.status, error: msg.slice(0, 800) };
    }
    return { ok: true as const, provider: "fetch" as const, status: res.status };
  } catch (e) {
    return { ok: false as const, provider: "fetch" as const, status: 0, error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}
