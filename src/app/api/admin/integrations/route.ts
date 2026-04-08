import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { IntegrationKind, IntegrationScope, IntegrationStatus, UserRole } from "@/generated/prisma/client";
import { createApiTokenIntegration, createOfficialEmailIntegration, createWebhookIntegration } from "@/lib/integrations";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

async function readBody(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return null;
  try {
    return (await req.json()) as unknown;
  } catch {
    return null;
  }
}

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  scope: z.nativeEnum(IntegrationScope),
  kind: z.nativeEnum(IntegrationKind),
  companyId: z.string().min(1).optional().nullable(),
  city: z.string().min(1).optional().nullable(),
  state: z.string().min(1).optional().nullable(),
  webhookUrl: z.string().url().optional().nullable(),
  webhookMethod: z.string().min(1).max(10).optional().nullable(),
  webhookHeaders: z.record(z.string(), z.string()).optional().nullable(),
  officialEmail: z.string().email().optional().nullable(),
});

function validateScope(input: z.infer<typeof CreateSchema>) {
  if (input.scope === IntegrationScope.COMPANY) return !!input.companyId && !input.city && !input.state;
  if (input.scope === IntegrationScope.CITY) return !!input.city && !!input.state && !input.companyId;
  return false;
}

export async function GET() {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const items = await prisma.integration.findMany({
    orderBy: [{ updatedAt: "desc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      scope: true,
      kind: true,
      status: true,
      companyId: true,
      city: true,
      state: true,
      webhookUrl: true,
      officialEmail: true,
      verifiedAt: true,
      lastUsedAt: true,
      createdAt: true,
      updatedAt: true,
      company: { select: { name: true, slug: true } },
    },
  });

  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `admin:integrations:create:${user.id}:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  const raw = await readBody(req);
  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const input = parsed.data;
  if (!validateScope(input)) return NextResponse.json({ error: "invalid_scope" }, { status: 400 });

  if (input.kind === IntegrationKind.WEBHOOK) {
    const url = (input.webhookUrl ?? "").trim();
    if (!url) return NextResponse.json({ error: "missing_webhook_url" }, { status: 400 });
    const created = await createWebhookIntegration({
      prisma,
      name: input.name,
      scope: input.scope,
      companyId: input.companyId ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      webhookUrl: url,
      webhookMethod: input.webhookMethod ?? "POST",
      webhookHeaders: input.webhookHeaders ?? null,
    });
    return NextResponse.json({ ok: true, id: created.id, signingSecret: created.signingSecret });
  }

  if (input.kind === IntegrationKind.API_TOKEN) {
    const created = await createApiTokenIntegration({
      prisma,
      name: input.name,
      scope: input.scope,
      companyId: input.companyId ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
    });
    return NextResponse.json({ ok: true, id: created.id, token: created.token });
  }

  if (input.kind === IntegrationKind.OFFICIAL_EMAIL) {
    const email = (input.officialEmail ?? "").trim();
    if (!email) return NextResponse.json({ error: "missing_official_email" }, { status: 400 });
    const created = await createOfficialEmailIntegration({
      prisma,
      name: input.name,
      scope: input.scope,
      companyId: input.companyId ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      officialEmail: email,
    });
    return NextResponse.json({ ok: true, id: created.id, status: IntegrationStatus.PENDING_VERIFICATION });
  }

  return NextResponse.json({ error: "unsupported_kind" }, { status: 400 });
}
