import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  ModerationActionType,
  UserRole,
} from "@/generated/prisma/client";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { applyModerationAction } from "@/lib/moderationActions";

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "content_type" }, { status: 415 });
  }

  const ipClient = getClientIp(req.headers);
  const rl = rateLimit({ key: `moderation:action:${ipClient}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const user = await requireUser();
  const allowedRoles: UserRole[] = [UserRole.MODERATOR, UserRole.LEGAL, UserRole.ADMIN];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | {
        complaintId?: string;
        action?: string;
        reason?: string;
        details?: string;
        edited?: { issue?: string; description?: string };
        aiSuggestionId?: string;
      }
    | null;

  if (!body?.complaintId || !body?.action) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const action = body.action.toUpperCase() as ModerationActionType;
  if (!Object.values(ModerationActionType).includes(action)) {
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;
  const result = await applyModerationAction({
    prisma,
    complaintId: body.complaintId,
    moderatorId: user.id,
    action,
    reason: body.reason ?? null,
    details: body.details ?? null,
    edited: body.edited ?? null,
    ip,
    userAgent,
    aiSuggestionId: body.aiSuggestionId ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true, id: result.id });
}
