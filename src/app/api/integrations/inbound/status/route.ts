import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateInboundIntegration, ingestExternalStatusUpdate } from "@/lib/integrations";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";

const BodySchema = z.object({
  complaintId: z.string().min(1),
  externalProtocol: z.string().min(1).max(120),
  externalStatus: z.string().min(1).max(80),
  message: z.string().max(600).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `integrations:inbound:status:${ip}`, limit: 240, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  const integration = await authenticateInboundIntegration({ prisma, req });
  if (!integration) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const raw = (await req.json().catch(() => null)) as unknown;
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const body = parsed.data;

  const result = await ingestExternalStatusUpdate({
    prisma,
    integrationId: integration.id,
    integrationScope: integration.scope,
    integrationCompanyId: integration.companyId ?? null,
    integrationCity: integration.city ?? null,
    integrationState: integration.state ?? null,
    complaintId: body.complaintId,
    externalProtocol: body.externalProtocol,
    externalStatus: body.externalStatus,
    message: body.message ?? null,
  });
  if (!result.ok) {
    const status = result.error === "scope_mismatch" ? 403 : 404;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, complaintStatus: result.complaintStatus });
}
