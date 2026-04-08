import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { AiModerationFeedbackOutcome, UserRole } from "@/generated/prisma/client";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export async function GET() {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const now = Date.now();
  const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const [suggestions, feedbackTotal, feedbackAccepted, feedbackRejected, byProvider, byFinalAction] =
    await prisma.$transaction([
      prisma.aiModerationSuggestion.count({ where: { createdAt: { gte: since30 } } }),
      prisma.aiModerationFeedback.count({ where: { createdAt: { gte: since30 } } }),
      prisma.aiModerationFeedback.count({
        where: { createdAt: { gte: since30 }, outcome: AiModerationFeedbackOutcome.ACCEPTED },
      }),
      prisma.aiModerationFeedback.count({
        where: { createdAt: { gte: since30 }, outcome: AiModerationFeedbackOutcome.REJECTED },
      }),
      prisma.aiModerationSuggestion.groupBy({
        by: ["provider"],
        where: { createdAt: { gte: since30 } },
        orderBy: { provider: "asc" },
        _count: { _all: true },
      }),
      prisma.aiModerationFeedback.groupBy({
        by: ["finalAction"],
        where: { createdAt: { gte: since30 }, outcome: AiModerationFeedbackOutcome.ACCEPTED, finalAction: { not: null } },
        orderBy: { finalAction: "asc" },
        _count: { _all: true },
      }),
    ]);

  const acceptanceRate = feedbackTotal ? feedbackAccepted / feedbackTotal : 0;

  function countAll(r: { _count?: unknown }) {
    const c = r._count;
    if (c && typeof c === "object" && "_all" in c) {
      const n = (c as { _all?: unknown })._all;
      return typeof n === "number" ? n : 0;
    }
    return 0;
  }

  return NextResponse.json({
    windowDays: 30,
    suggestions,
    feedback: {
      total: feedbackTotal,
      accepted: feedbackAccepted,
      rejected: feedbackRejected,
      acceptanceRate,
    },
    byProvider: byProvider.map((r) => ({ provider: r.provider, count: countAll(r) })),
    byFinalAction: byFinalAction.map((r) => ({ finalAction: r.finalAction, count: countAll(r) })),
  });
}
