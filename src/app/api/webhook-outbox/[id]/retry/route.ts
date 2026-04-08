import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { UserRole, WebhookStatus } from "@/generated/prisma/client";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const item = await prisma.webhookOutbox.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.webhookOutbox.update({
    where: { id },
    data: { status: WebhookStatus.PENDING, error: null, sentAt: null },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "RETRY_WEBHOOK_OUTBOX",
      tableName: "WebhookOutbox",
      recordId: id,
      previousData: {
        status: item.status,
        error: item.error,
        sentAt: item.sentAt ? item.sentAt.toISOString() : null,
        integrationId: item.integrationId ?? null,
      },
      newData: { status: WebhookStatus.PENDING, integrationId: item.integrationId ?? null },
      ip: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true });
}
