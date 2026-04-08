import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  ComplaintEventType,
  ComplaintStatus,
  ComplaintVisibility,
  ModerationActionType,
  NotificationType,
} from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  const c = await prisma.complaint.findUnique({
    where: { id, userId: user.id },
    include: {
      company: true,
      events: { orderBy: { createdAt: "asc" } },
      responses: { orderBy: { createdAt: "asc" } },
      contestations: { orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "desc" } },
      moderation: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const latest = c.moderation[0];
  const proofRequired = latest?.action === ModerationActionType.REQUESTED_PROOF;

  return NextResponse.json({
    ...c,
    proofRequired,
    latestModerationAction: latest
      ? {
          id: latest.id,
          action: latest.action,
          reason: latest.reason,
          details: latest.details,
          createdAt: latest.createdAt,
        }
      : null,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();

  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
  const confirm = (body?.confirm ?? "").trim().toUpperCase();

  const c = await prisma.complaint.findUnique({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const short = c.id.slice(-6).toUpperCase();
  if (confirm !== short) {
    return NextResponse.json({ error: "Confirmação inválida" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.complaint.update({
      where: { id: c.id },
      data: {
        status: ComplaintStatus.CLOSED,
        visibility: ComplaintVisibility.PRIVATE,
        events: {
          create: {
            type: ComplaintEventType.CLOSED,
            message: "Reclamação removida a pedido do usuário.",
          },
        },
      },
    });

    const prefs = await tx.user.findUnique({
      where: { id: user.id },
      select: { notifyInApp: true },
    });
    if (!prefs || prefs.notifyInApp) {
      await tx.notification.create({
        data: {
          userId: user.id,
          type: NotificationType.SYSTEM,
          title: "Reclamação removida",
          message: "Sua reclamação foi removida a seu pedido.",
          actionUrl: `/complaints/${c.id}`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "REMOVE_COMPLAINT",
        tableName: "Complaint",
        recordId: c.id,
        newData: { status: ComplaintStatus.CLOSED, visibility: ComplaintVisibility.PRIVATE },
        ip: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
