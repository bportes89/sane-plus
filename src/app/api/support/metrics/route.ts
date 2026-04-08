import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { SupportTicketStatus, UserRole } from "@/generated/prisma/client";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export async function GET() {
  const user = await requireUser();
  if (!isStaff(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const tickets = await prisma.supportTicket.findMany({
    where: { createdAt: { gte: since } },
    select: {
      category: true,
      createdAt: true,
      firstStaffReplyAt: true,
      closedAt: true,
      status: true,
      reopenCount: true,
      rating: { select: { score: true } },
    },
    take: 2000,
  });

  const adjustedMessages = await prisma.supportMessage.count({
    where: { createdAt: { gte: since }, NOT: { originalBody: null } },
  });

  const responseTimes: number[] = [];
  const resolutionTimes: number[] = [];
  const ratings: number[] = [];
  let closed = 0;
  let reopened = 0;
  const byCategory: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const t of tickets) {
    if (t.firstStaffReplyAt) {
      responseTimes.push(t.firstStaffReplyAt.getTime() - t.createdAt.getTime());
    }
    if (t.closedAt) {
      resolutionTimes.push(t.closedAt.getTime() - t.createdAt.getTime());
    }
    if (t.status === SupportTicketStatus.CLOSED) closed += 1;
    if (t.reopenCount > 0) reopened += 1;
    if (t.rating?.score) ratings.push(t.rating.score);
    byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  }

  const avg = (arr: number[]) =>
    arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  return NextResponse.json({
    windowDays: 30,
    tickets: tickets.length,
    closed,
    reopened,
    avgFirstResponseMs: avg(responseTimes),
    avgResolutionMs: avg(resolutionTimes),
    avgSatisfaction: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    adjustedMessages,
    byCategory,
    byStatus,
  });
}
