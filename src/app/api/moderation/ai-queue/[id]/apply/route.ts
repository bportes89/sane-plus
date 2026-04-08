import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { AiModerationTarget, ModerationActionType, UserRole } from "@/generated/prisma/client";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";
import { applyCompanyResponseModerationSuggestion, applyModerationAction } from "@/lib/moderationActions";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ipClient = getClientIp(req.headers);
  const rl = rateLimit({ key: `moderation:ai-queue:apply:${user.id}:${ipClient}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { id } = await params;
  const queue = await prisma.aiModerationQueueItem.findUnique({
    where: { id },
    select: {
      id: true,
      suggestion: {
        select: {
          id: true,
          target: true,
          complaintId: true,
          responseId: true,
          recommendedAction: true,
          recommendedEdits: true,
          provider: true,
          model: true,
        },
      },
    },
  });
  if (!queue) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const action = queue.suggestion.recommendedAction;
  if (!action) {
    return NextResponse.json({ error: "invalid_suggestion" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const providerLabel = `${queue.suggestion.provider}${queue.suggestion.model ? `:${queue.suggestion.model}` : ""}`;

  if (queue.suggestion.target === AiModerationTarget.COMPANY_RESPONSE) {
    const allowed: ModerationActionType[] = [ModerationActionType.HIDDEN, ModerationActionType.RESTORED, ModerationActionType.REMOVED];
    if (!allowed.includes(action)) {
      return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    }
    const result = await applyCompanyResponseModerationSuggestion({
      prisma,
      suggestionId: queue.suggestion.id,
      moderatorId: user.id,
      providerLabel,
      queueItemId: queue.id,
      ip,
      userAgent,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, moderationActionId: result.moderationActionId });
  }

  const complaintId = queue.suggestion.complaintId;
  if (!complaintId) return NextResponse.json({ error: "invalid_suggestion" }, { status: 400 });

  const edited =
    action === ModerationActionType.EDITED && queue.suggestion.recommendedEdits && typeof queue.suggestion.recommendedEdits === "object"
      ? (queue.suggestion.recommendedEdits as { issue?: string; description?: string })
      : null;

  const applied = await applyModerationAction({
    prisma,
    complaintId,
    moderatorId: user.id,
    action,
    reason: `Confirmação de sugestão por IA (${providerLabel})`,
    details: `aiQueueItemId=${queue.id}`,
    edited,
    ip,
    userAgent,
    aiSuggestionId: queue.suggestion.id,
  });
  if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: 404 });

  return NextResponse.json({ ok: true, moderationActionId: applied.id });
}
