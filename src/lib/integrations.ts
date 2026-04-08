import type { PrismaClient } from "@/generated/prisma/client";
import { ComplaintEventType, ComplaintStatus, IntegrationKind, IntegrationScope, IntegrationStatus } from "@/generated/prisma/client";
import crypto from "node:crypto";
import { queueEmail } from "@/lib/outbox";
import { queueWebhook } from "@/lib/webhooks";

function masterKeyBytes() {
  const raw = (process.env.INTEGRATIONS_MASTER_KEY ?? "").trim();
  if (!raw) return null;
  try {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;
    return null;
  } catch {
    return null;
  }
}

export function encryptIntegrationSecret(plaintext: string) {
  const key = masterKeyBytes();
  if (!key) return `plain:${plaintext}`;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, enc]).toString("base64")}`;
}

export function decryptIntegrationSecret(enc: string) {
  if (enc.startsWith("plain:")) return enc.slice("plain:".length);
  if (!enc.startsWith("v1:")) throw new Error("invalid_secret_format");
  const key = masterKeyBytes();
  if (!key) throw new Error("missing_master_key");
  const raw = Buffer.from(enc.slice("v1:".length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return out.toString("utf8");
}

export function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function signWebhook(args: { secret: string; timestamp: number; body: string }) {
  const base = `${args.timestamp}.${args.body}`;
  return crypto.createHmac("sha256", args.secret).update(base).digest("hex");
}

export async function authenticateInboundIntegration(args: { prisma: PrismaClient; req: Request }) {
  const auth = args.req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const integration = await args.prisma.integration.findFirst({
    where: { kind: IntegrationKind.API_TOKEN, status: IntegrationStatus.ACTIVE, inboundTokenHash: tokenHash },
    select: { id: true, scope: true, companyId: true, city: true, state: true },
  });
  if (!integration) return null;
  await args.prisma.integration.update({ where: { id: integration.id }, data: { lastUsedAt: new Date() } });
  return integration;
}

export async function createWebhookIntegration(args: {
  prisma: PrismaClient;
  name: string;
  scope: IntegrationScope;
  companyId?: string | null;
  city?: string | null;
  state?: string | null;
  webhookUrl: string;
  webhookMethod?: string | null;
  webhookHeaders?: Record<string, string> | null;
}) {
  const secret = generateToken(32);
  const created = await args.prisma.integration.create({
    data: {
      name: args.name,
      scope: args.scope,
      kind: IntegrationKind.WEBHOOK,
      status: IntegrationStatus.ACTIVE,
      companyId: args.companyId ?? null,
      city: args.city ?? null,
      state: args.state ?? null,
      webhookUrl: args.webhookUrl,
      webhookMethod: (args.webhookMethod ?? "POST").toUpperCase(),
      webhookHeaders: args.webhookHeaders ? (args.webhookHeaders as unknown as object) : undefined,
      signingSecretEnc: encryptIntegrationSecret(secret),
      verifiedAt: new Date(),
    },
    select: { id: true },
  });
  return { id: created.id, signingSecret: secret };
}

export async function createApiTokenIntegration(args: {
  prisma: PrismaClient;
  name: string;
  scope: IntegrationScope;
  companyId?: string | null;
  city?: string | null;
  state?: string | null;
}) {
  const token = generateToken(32);
  const created = await args.prisma.integration.create({
    data: {
      name: args.name,
      scope: args.scope,
      kind: IntegrationKind.API_TOKEN,
      status: IntegrationStatus.ACTIVE,
      companyId: args.companyId ?? null,
      city: args.city ?? null,
      state: args.state ?? null,
      inboundTokenHash: sha256Hex(token),
      verifiedAt: new Date(),
    },
    select: { id: true },
  });
  return { id: created.id, token };
}

export async function createOfficialEmailIntegration(args: {
  prisma: PrismaClient;
  name: string;
  scope: IntegrationScope;
  companyId?: string | null;
  city?: string | null;
  state?: string | null;
  officialEmail: string;
}) {
  const token = generateToken(24);
  const created = await args.prisma.integration.create({
    data: {
      name: args.name,
      scope: args.scope,
      kind: IntegrationKind.OFFICIAL_EMAIL,
      status: IntegrationStatus.PENDING_VERIFICATION,
      companyId: args.companyId ?? null,
      city: args.city ?? null,
      state: args.state ?? null,
      officialEmail: args.officialEmail,
      emailVerifyTokenHash: sha256Hex(token),
    },
    select: { id: true, officialEmail: true },
  });
  await sendOfficialEmailVerification({ prisma: args.prisma, integrationId: created.id, token });
  return { id: created.id };
}

export async function sendOfficialEmailVerification(args: { prisma: PrismaClient; integrationId: string; token: string }) {
  const integration = await args.prisma.integration.findUnique({
    where: { id: args.integrationId },
    select: { id: true, officialEmail: true, name: true },
  });
  const to = integration?.officialEmail?.trim() ?? "";
  if (!integration || !to) return null;

  const appUrl = (process.env.APP_URL ?? "").trim() || "http://localhost:3000";
  const url = `${appUrl.replace(/\/$/, "")}/api/integrations/verify-email?token=${encodeURIComponent(args.token)}`;
  await queueEmail({
    to,
    subject: "Confirmação de e-mail oficial — SANE+",
    body: `Olá,\n\nPara confirmar o e-mail oficial da integração "${integration.name}", acesse:\n\n${url}\n\nSe você não solicitou isso, ignore.\n`,
    meta: { integrationId: integration.id, type: "INTEGRATION_EMAIL_VERIFY" },
  });
  return true;
}

export async function verifyOfficialEmailToken(args: { prisma: PrismaClient; token: string }) {
  const tokenHash = sha256Hex(args.token);
  const integration = await args.prisma.integration.findFirst({
    where: { kind: IntegrationKind.OFFICIAL_EMAIL, status: IntegrationStatus.PENDING_VERIFICATION, emailVerifyTokenHash: tokenHash },
    select: { id: true },
  });
  if (!integration) return { ok: false as const, error: "invalid_token" as const };
  await args.prisma.integration.update({
    where: { id: integration.id },
    data: { status: IntegrationStatus.ACTIVE, verifiedAt: new Date(), emailVerifyTokenHash: null },
  });
  return { ok: true as const, id: integration.id };
}

function mapExternalStatus(externalStatus: string) {
  const s = externalStatus.trim().toUpperCase();
  if (s === "VIEWED" || s === "SEEN" || s === "COMPANY_VIEWED") {
    return { event: ComplaintEventType.COMPANY_VIEWED, status: ComplaintStatus.COMPANY_VIEWED };
  }
  if (s === "REPLIED" || s === "ANSWERED" || s === "COMPANY_REPLIED") {
    return { event: ComplaintEventType.COMPANY_REPLIED, status: ComplaintStatus.COMPANY_REPLIED };
  }
  if (s === "RESOLVED" || s === "SOLVED") {
    return { event: ComplaintEventType.MARKED_RESOLVED, status: ComplaintStatus.RESOLVED };
  }
  if (s === "CLOSED") {
    return { event: ComplaintEventType.CLOSED, status: ComplaintStatus.CLOSED };
  }
  return null;
}

export async function ingestExternalStatusUpdate(args: {
  prisma: PrismaClient;
  integrationId: string;
  integrationScope: IntegrationScope;
  integrationCompanyId: string | null;
  integrationCity: string | null;
  integrationState: string | null;
  complaintId: string;
  externalProtocol: string;
  externalStatus: string;
  message?: string | null;
}) {
  const mapping = mapExternalStatus(args.externalStatus);
  const now = new Date();

  const updated = await args.prisma.$transaction(async (tx) => {
    const complaint = await tx.complaint.findUnique({
      where: { id: args.complaintId },
      select: {
        id: true,
        status: true,
        resolvedAt: true,
        companyId: true,
        company: { select: { city: true, state: true } },
      },
    });
    if (!complaint) return { ok: false as const, error: "not_found" as const };

    if (args.integrationScope === IntegrationScope.COMPANY) {
      if (!args.integrationCompanyId || complaint.companyId !== args.integrationCompanyId) {
        return { ok: false as const, error: "scope_mismatch" as const };
      }
    } else {
      const cityOk = !!args.integrationCity && !!args.integrationState;
      const cCity = complaint.company.city?.trim() ?? null;
      const cState = complaint.company.state?.trim() ?? null;
      const match = cityOk && cCity === args.integrationCity && cState === args.integrationState;
      if (!match) return { ok: false as const, error: "scope_mismatch" as const };
    }

    await tx.externalProtocol.upsert({
      where: { integrationId_complaintId: { integrationId: args.integrationId, complaintId: args.complaintId } },
      create: {
        integrationId: args.integrationId,
        complaintId: args.complaintId,
        externalProtocol: args.externalProtocol,
        externalStatus: args.externalStatus,
        lastSyncedAt: now,
      },
      update: { externalProtocol: args.externalProtocol, externalStatus: args.externalStatus, lastSyncedAt: now },
    });

    if (!mapping) return { ok: true as const, complaintStatus: complaint.status };

    const nextStatus = mapping.status;
    const order: ComplaintStatus[] = [
      ComplaintStatus.REGISTERED,
      ComplaintStatus.NEEDS_REVIEW,
      ComplaintStatus.PUBLISHED,
      ComplaintStatus.COMPANY_VIEWED,
      ComplaintStatus.COMPANY_REPLIED,
      ComplaintStatus.USER_CONTESTED,
      ComplaintStatus.RESOLVED,
      ComplaintStatus.CLOSED,
    ];
    const canAdvance = order.indexOf(nextStatus) >= 0 && order.indexOf(nextStatus) >= order.indexOf(complaint.status);
    if (!canAdvance) return { ok: true as const, complaintStatus: complaint.status };

    await tx.complaint.update({
      where: { id: args.complaintId },
      data: {
        status: nextStatus,
        resolvedAt: nextStatus === ComplaintStatus.RESOLVED ? now : complaint.resolvedAt,
      },
    });
    await tx.complaintEvent.create({
      data: {
        complaintId: args.complaintId,
        type: mapping.event,
        message: args.message?.trim()
          ? `Atualização institucional: ${args.message.trim()}`
          : `Atualização institucional: ${args.externalStatus}`,
      },
    });
    return { ok: true as const, complaintStatus: nextStatus };
  });

  return updated;
}

export async function publishIntegrationEvent(args: {
  prisma: PrismaClient;
  companyId: string;
  city: string | null;
  state: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const integrations = await args.prisma.integration.findMany({
    where: {
      kind: IntegrationKind.WEBHOOK,
      status: IntegrationStatus.ACTIVE,
      webhookUrl: { not: null },
      signingSecretEnc: { not: null },
      OR: [
        { scope: IntegrationScope.COMPANY, companyId: args.companyId },
        args.city && args.state ? { scope: IntegrationScope.CITY, city: args.city, state: args.state } : undefined,
      ].filter(Boolean) as unknown as Array<Record<string, unknown>>,
    },
    select: { id: true, webhookUrl: true, webhookMethod: true, webhookHeaders: true, signingSecretEnc: true },
    take: 25,
  });
  if (!integrations.length) return { queued: 0 };

  const timestamp = Date.now();
  const body = JSON.stringify({
    id: `evt_${generateToken(12)}`,
    type: args.eventType,
    ts: new Date(timestamp).toISOString(),
    payload: args.payload,
  });

  let queued = 0;
  for (const i of integrations) {
    const secret = decryptIntegrationSecret(i.signingSecretEnc ?? "");
    const signature = signWebhook({ secret, timestamp, body });
    const headers: Record<string, string> = {
      "x-saneplus-event": args.eventType,
      "x-saneplus-timestamp": String(timestamp),
      "x-saneplus-signature": signature,
      "x-saneplus-integration-id": i.id,
    };
    const extra =
      i.webhookHeaders && typeof i.webhookHeaders === "object" && !Array.isArray(i.webhookHeaders)
        ? (i.webhookHeaders as Record<string, string>)
        : null;
    await queueWebhook({
      url: i.webhookUrl ?? null,
      method: i.webhookMethod ?? "POST",
      headers: extra ? { ...headers, ...extra } : headers,
      body,
      integrationId: i.id,
      meta: { integrationId: i.id, type: args.eventType },
    });
    queued += 1;
  }

  return { queued };
}

export async function publishOfficialEmail(args: {
  prisma: PrismaClient;
  companyId: string;
  city: string | null;
  state: string | null;
  subject: string;
  body: string;
  meta?: Record<string, unknown>;
}) {
  const integrations = await args.prisma.integration.findMany({
    where: {
      kind: IntegrationKind.OFFICIAL_EMAIL,
      status: IntegrationStatus.ACTIVE,
      officialEmail: { not: null },
      OR: [
        { scope: IntegrationScope.COMPANY, companyId: args.companyId },
        args.city && args.state ? { scope: IntegrationScope.CITY, city: args.city, state: args.state } : undefined,
      ].filter(Boolean) as unknown as Array<Record<string, unknown>>,
    },
    select: { id: true, officialEmail: true },
    take: 25,
  });
  if (!integrations.length) return { queued: 0 };

  let queued = 0;
  for (const i of integrations) {
    const to = i.officialEmail?.trim();
    if (!to) continue;
    await queueEmail({
      to,
      subject: args.subject,
      body: args.body,
      integrationId: i.id,
      meta: { integrationId: i.id, ...(args.meta ?? {}) },
    });
    queued += 1;
  }
  return { queued };
}

export async function publishIntegrationEventToCityScope(args: {
  prisma: PrismaClient;
  city?: string | null;
  state?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const integrations = await args.prisma.integration.findMany({
    where: {
      kind: IntegrationKind.WEBHOOK,
      status: IntegrationStatus.ACTIVE,
      webhookUrl: { not: null },
      signingSecretEnc: { not: null },
      scope: IntegrationScope.CITY,
      ...(args.state ? { state: args.state } : {}),
      ...(args.city ? { city: args.city } : {}),
    },
    select: { id: true, webhookUrl: true, webhookMethod: true, webhookHeaders: true, signingSecretEnc: true },
    take: 50,
  });
  if (!integrations.length) return { queued: 0 };

  const timestamp = Date.now();
  const body = JSON.stringify({
    id: `evt_${generateToken(12)}`,
    type: args.eventType,
    ts: new Date(timestamp).toISOString(),
    payload: args.payload,
  });

  let queued = 0;
  for (const i of integrations) {
    const secret = decryptIntegrationSecret(i.signingSecretEnc ?? "");
    const signature = signWebhook({ secret, timestamp, body });
    const headers: Record<string, string> = {
      "x-saneplus-event": args.eventType,
      "x-saneplus-timestamp": String(timestamp),
      "x-saneplus-signature": signature,
      "x-saneplus-integration-id": i.id,
    };
    const extra =
      i.webhookHeaders && typeof i.webhookHeaders === "object" && !Array.isArray(i.webhookHeaders)
        ? (i.webhookHeaders as Record<string, string>)
        : null;
    await queueWebhook({
      url: i.webhookUrl ?? null,
      method: i.webhookMethod ?? "POST",
      headers: extra ? { ...headers, ...extra } : headers,
      body,
      integrationId: i.id,
      meta: { integrationId: i.id, type: args.eventType },
    });
    queued += 1;
  }

  return { queued };
}

export async function publishOfficialEmailToCityScope(args: {
  prisma: PrismaClient;
  city?: string | null;
  state?: string | null;
  subject: string;
  body: string;
  meta?: Record<string, unknown>;
}) {
  const integrations = await args.prisma.integration.findMany({
    where: {
      kind: IntegrationKind.OFFICIAL_EMAIL,
      status: IntegrationStatus.ACTIVE,
      officialEmail: { not: null },
      scope: IntegrationScope.CITY,
      ...(args.state ? { state: args.state } : {}),
      ...(args.city ? { city: args.city } : {}),
    },
    select: { id: true, officialEmail: true },
    take: 50,
  });
  if (!integrations.length) return { queued: 0 };

  let queued = 0;
  for (const i of integrations) {
    const to = i.officialEmail?.trim();
    if (!to) continue;
    await queueEmail({
      to,
      subject: args.subject,
      body: args.body,
      integrationId: i.id,
      meta: { integrationId: i.id, ...(args.meta ?? {}) },
    });
    queued += 1;
  }
  return { queued };
}
