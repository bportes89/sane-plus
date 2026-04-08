import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  NotificationType,
  Prisma,
  SupportTicketStatus,
  UserRole,
} from "@/generated/prisma/client";
import { autoModerateSupportMessage } from "@/lib/moderation";
import type { NextRequest } from "next/server";
import { queueEmail } from "@/lib/outbox";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

const forbiddenRequests = [
  /\bcpf\b/i,
  /\brg\b/i,
  /\bendereço completo\b/i,
  /\bendereco completo\b/i,
  /\bdados banc[aá]rios\b/i,
  /\bcart[aã]o\b/i,
  /\bselfie\b/i,
  /\bfoto (do|da) documento\b/i,
  /\bfoto (do|da) identidade\b/i,
  /\bcomprovante de resid[eê]ncia\b/i,
];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      complaint: { select: { id: true, issue: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { sender: { select: { id: true, name: true, email: true, role: true } } },
      },
      attachments: { orderBy: { createdAt: "desc" } },
      rating: true,
    },
  });
  if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isStaff(user.role) && ticket.userId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json(ticket);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "content_type" }, { status: 415 });
  }

  const { id } = await params;
  const user = await requireUser();
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `support:ticket:message:${id}:${user.id}:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const body = (await req.json().catch(() => null)) as { message?: string } | null;
  if (!body?.message || body.message.trim().length < 2) {
    return NextResponse.json({ error: "Mensagem inválida" }, { status: 400 });
  }
  const message = body.message.trim();
  const staff = isStaff(user.role);

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, firstStaffReplyAt: true },
  });
  if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!staff && ticket.userId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (staff) {
    const hit = forbiddenRequests.find((re) => re.test(message));
    if (hit) {
      return NextResponse.json(
        { error: "Por segurança, não solicite dados sensíveis no atendimento." },
        { status: 400 },
      );
    }
  }

  const moderated = autoModerateSupportMessage(message);

  const ipAudit = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.supportMessage.create({
      data: {
        ticketId: ticket.id,
        senderUserId: user.id,
        senderRole: user.role,
        body: moderated.output,
        originalBody: moderated.adjusted ? message : null,
        flags: moderated.flags,
      },
      select: { id: true, createdAt: true },
    });

    const updates: Prisma.SupportTicketUpdateInput = {};

    if (!staff && ticket.status === SupportTicketStatus.CLOSED) {
      updates.status = SupportTicketStatus.OPEN;
      updates.reopenCount = { increment: 1 };
      updates.closedAt = null;
    }

    if (staff && !ticket.firstStaffReplyAt) {
      updates.firstStaffReplyAt = new Date();
    }

    if (staff && ticket.status !== SupportTicketStatus.CLOSED) {
      updates.status = SupportTicketStatus.PENDING_USER;
    }
    if (!staff && ticket.status !== SupportTicketStatus.CLOSED) {
      updates.status = SupportTicketStatus.PENDING_SUPPORT;
    }

    await tx.supportTicket.update({
      where: { id: ticket.id },
      data: updates,
    });

    if (staff) {
      const recipient = await tx.user.findUnique({
        where: { id: ticket.userId },
        select: { notifyInApp: true },
      });
      if (!recipient || recipient.notifyInApp) {
        await tx.notification.create({
          data: {
            userId: ticket.userId,
            type: NotificationType.SYSTEM,
            title: "Suporte respondeu",
            message: "Recebemos uma resposta no seu chamado. Abra para ver.",
            actionUrl: `/support/chat/${ticket.id}`,
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "SUPPORT_MESSAGE",
        tableName: "SupportTicket",
        recordId: ticket.id,
        newData: { ticketId: ticket.id, messageId: created.id },
        ip: ipAudit,
        userAgent,
      },
    });

    return created;
  });

  if (staff) {
    const t = await prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, subject: true, user: { select: { id: true, email: true } } },
    });
    if (t?.user?.email) {
      await queueEmail({
        to: t.user.email,
        subject: "SANE+ • Temos uma resposta no seu chamado",
        body:
          "Olá! Nossa equipe respondeu seu chamado no SANE+. Acesse o app para visualizar e responder.\n\nAssunto: " +
          (t.subject ?? ""),
        userId: t.user.id,
        ticketId: t.id,
        meta: { type: "support_reply" },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    createdAt: result.createdAt,
    moderation: moderated.flags,
  });
}
