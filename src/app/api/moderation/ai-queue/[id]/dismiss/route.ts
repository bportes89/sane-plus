import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { UserRole } from "@/generated/prisma/client";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";
import { dismissAiModerationSuggestion } from "@/lib/moderationActions";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ipClient = getClientIp(req.headers);
  const rl = rateLimit({ key: `moderation:ai-queue:dismiss:${user.id}:${ipClient}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { id } = await params;
  const queue = await prisma.aiModerationQueueItem.findUnique({
    where: { id },
    select: { suggestionId: true },
  });
  if (!queue) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { notes?: string } | null;
  const ip = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const result = await dismissAiModerationSuggestion({
    prisma,
    suggestionId: queue.suggestionId,
    moderatorId: user.id,
    notes: body?.notes ?? null,
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true, id: result.id });
}

