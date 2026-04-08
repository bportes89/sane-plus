import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { NotificationType, SupportTicketStatus, UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";
import { addPoints } from "@/lib/badges";
import { queueEmail } from "@/lib/outbox";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  const staff = isStaff(user.role);

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true },
  });
  if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!staff && ticket.userId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (ticket.status === SupportTicketStatus.CLOSED) return NextResponse.json({ ok: true });

  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({
      where: { id: ticket.id },
      data: { status: SupportTicketStatus.CLOSED, closedAt: new Date() },
    });

    if (staff) {
      const prefs = await tx.user.findUnique({
        where: { id: ticket.userId },
        select: { notifyInApp: true },
      });
      if (!prefs || prefs.notifyInApp) {
        await tx.notification.create({
          data: {
            userId: ticket.userId,
            type: NotificationType.SYSTEM,
            title: "Chamado encerrado",
            message: "Seu chamado foi encerrado. Você pode reabrir enviando uma nova mensagem.",
            actionUrl: `/support/chat/${ticket.id}`,
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "CLOSE_SUPPORT_TICKET",
        tableName: "SupportTicket",
        recordId: ticket.id,
        newData: { status: SupportTicketStatus.CLOSED },
        ip: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });
  });

  if (!staff) {
    await addPoints(user.id, 1);
  }

  if (staff) {
    const t = await prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, subject: true, user: { select: { id: true, email: true } } },
    });
    if (t?.user?.email) {
      await queueEmail({
        to: t.user.email,
        subject: "SANE+ • Seu chamado foi encerrado",
        body:
          "Olá! Encerramos seu chamado no SANE+. Se precisar, você pode reabrir enviando uma nova mensagem no mesmo chamado.\n\nAssunto: " +
          (t.subject ?? ""),
        userId: t.user.id,
        ticketId: t.id,
        meta: { type: "support_closed" },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
