import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  ComplaintEventType,
  ComplaintStatus,
  NotificationType,
  SupportTicketStatus,
  UserRole,
} from "@/generated/prisma/client";
import type { NextRequest } from "next/server";
import { queueEmail } from "@/lib/outbox";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `support:ticket:escalate:${user.id}:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, complaintId: true },
  });
  if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (ticket.status === SupportTicketStatus.CLOSED) {
    return NextResponse.json({ error: "Chamado encerrado" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({
      where: { id: ticket.id },
      data: { status: SupportTicketStatus.ESCALATED_MODERATION },
    });

    if (ticket.complaintId) {
      const complaint = await tx.complaint.findUnique({
        where: { id: ticket.complaintId },
        select: { id: true, status: true, userId: true },
      });

      if (complaint && complaint.status !== ComplaintStatus.CLOSED) {
        if (complaint.status !== ComplaintStatus.NEEDS_REVIEW) {
          await tx.complaint.update({
            where: { id: complaint.id },
            data: {
              status: ComplaintStatus.NEEDS_REVIEW,
              events: {
                create: {
                  type: ComplaintEventType.CONTENT_ADJUSTED,
                  message: "Sua reclamação foi encaminhada para análise de moderação.",
                },
              },
            },
          });

          const complaintRecipient = await tx.user.findUnique({
            where: { id: complaint.userId },
            select: { notifyInApp: true },
          });
          if (!complaintRecipient || complaintRecipient.notifyInApp) {
            await tx.notification.create({
              data: {
                userId: complaint.userId,
                type: NotificationType.MODERATION,
                title: "Reclamação em análise",
                message: "Encaminhamos sua reclamação para revisão do time de moderação.",
                actionUrl: `/complaints/${complaint.id}`,
              },
            });
          }
        } else {
          await tx.complaintEvent.create({
            data: {
              complaintId: complaint.id,
              type: ComplaintEventType.CONTENT_ADJUSTED,
              message: "Reforço: sua reclamação segue em análise de moderação.",
            },
          });
        }
      }
    }

    const ticketRecipient = await tx.user.findUnique({
      where: { id: ticket.userId },
      select: { notifyInApp: true },
    });
    if (!ticketRecipient || ticketRecipient.notifyInApp) {
      await tx.notification.create({
        data: {
          userId: ticket.userId,
          type: NotificationType.MODERATION,
          title: "Chamado encaminhado",
          message: "Encaminhamos seu chamado para análise de moderação. Você será notificado sobre atualizações.",
          actionUrl: `/support/chat/${ticket.id}`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "ESCALATE_SUPPORT_TICKET",
        tableName: "SupportTicket",
        recordId: ticket.id,
        newData: { status: SupportTicketStatus.ESCALATED_MODERATION, complaintId: ticket.complaintId },
        ip: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });
  });

  const t = await prisma.supportTicket.findUnique({
    where: { id },
    select: { id: true, subject: true, user: { select: { id: true, email: true } } },
  });
  if (t?.user?.email) {
    await queueEmail({
      to: t.user.email,
      subject: "SANE+ • Seu chamado foi encaminhado para moderação",
      body:
        "Olá! Seu chamado foi encaminhado para o time de moderação para uma análise especializada. Avisaremos assim que houver atualização.\n\nAssunto: " +
        (t.subject ?? ""),
      userId: t.user.id,
      ticketId: t.id,
      meta: { type: "support_escalated" },
    });
  }

  return NextResponse.json({ ok: true });
}
