import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { UserRole, AiModerationQueueStatus } from "@/generated/prisma/client";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

function toInt(v: string | null) {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(100, toInt(url.searchParams.get("limit")) ?? 50));

  const items = await prisma.aiModerationQueueItem.findMany({
    where: { status: { in: [AiModerationQueueStatus.PENDING, AiModerationQueueStatus.IN_REVIEW] } },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: limit,
    select: {
      id: true,
      status: true,
      priority: true,
      assignedToId: true,
      createdAt: true,
      suggestion: {
        select: {
          id: true,
          target: true,
          status: true,
          recommendedAction: true,
          recommendedEdits: true,
          score: true,
          explanation: true,
          provider: true,
          model: true,
          createdAt: true,
          response: {
            select: { id: true, status: true, createdAt: true, company: { select: { name: true } } },
          },
          complaint: {
            select: { id: true, issue: true, status: true, visibility: true, createdAt: true, company: { select: { name: true } } },
          },
        },
      },
    },
  });

  return NextResponse.json(items);
}
