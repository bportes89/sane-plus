import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { IntegrationKind, IntegrationStatus, UserRole } from "@/generated/prisma/client";
import { generateToken, sha256Hex } from "@/lib/integrations";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `admin:integrations:rotate-token:${user.id}:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  const { id } = await params;
  const integration = await prisma.integration.findUnique({
    where: { id },
    select: { id: true, kind: true, status: true },
  });
  if (!integration) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (integration.kind !== IntegrationKind.API_TOKEN) return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  if (integration.status !== IntegrationStatus.ACTIVE) return NextResponse.json({ error: "inactive" }, { status: 400 });

  const token = generateToken(32);
  await prisma.integration.update({ where: { id }, data: { inboundTokenHash: sha256Hex(token) } });
  return NextResponse.json({ ok: true, token });
}

