import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  NotificationType,
  SupportTicketCategory,
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

export async function GET(req: NextRequest) {
  const user = await requireUser();
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";

  if (all && !isStaff(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const items = await prisma.supportTicket.findMany({
    where: all ? {} : { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: {
      id: true,
      subject: true,
      category: true,
      status: true,
      complaintId: true,
      createdAt: true,
      updatedAt: true,
      closedAt: true,
      reopenCount: true,
      user: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "content_type" }, { status: 415 });
  }

  const user = await requireUser();
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `support:ticket:create:${user.id}:${ip}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | {
        subject?: string;
        message?: string;
        category?: string;
        complaintId?: string;
        deviceModel?: string;
        appVersion?: string;
      }
    | null;

  if (!body?.subject || !body.message) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  const subject = body.subject.trim();
  const message = body.message.trim();
  if (subject.length < 4 || message.length < 5) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const category = (body.category?.toUpperCase() ??
    "GENERAL") as SupportTicketCategory;
  if (!Object.values(SupportTicketCategory).includes(category)) {
    return NextResponse.json({ error: "Categoria inválida" }, { status: 400 });
  }

  if (body.complaintId) {
    const exists = await prisma.complaint.findUnique({
      where: { id: body.complaintId, userId: user.id },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json({ error: "Reclamação inválida" }, { status: 400 });
    }
  }

  const moderated = autoModerateSupportMessage(message);

  const created = await prisma.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.create({
      data: {
        userId: user.id,
        category,
        status: SupportTicketStatus.OPEN,
        subject,
        complaintId: body.complaintId ?? null,
        deviceModel: body.deviceModel?.trim() ? body.deviceModel.trim() : null,
        appVersion: body.appVersion?.trim() ? body.appVersion.trim() : null,
      },
      select: { id: true },
    });

    await tx.supportMessage.create({
      data: {
        ticketId: ticket.id,
        senderUserId: user.id,
        senderRole: user.role,
        body: moderated.output,
        originalBody: moderated.adjusted ? message : null,
        flags: moderated.flags,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "CREATE_SUPPORT_TICKET",
        tableName: "SupportTicket",
        recordId: ticket.id,
        newData: { category, subject, complaintId: body.complaintId ?? null },
        ip: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
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
          title: "Chamado registrado",
          message: "Sua solicitação foi registrada.",
          actionUrl: `/support/chat/${ticket.id}`,
        },
      });
    }

    return ticket;
  });

  if (user.email) {
    await queueEmail({
      to: user.email,
      subject: "SANE+ • Recebemos sua solicitação",
      body:
        "Olá! Recebemos seu chamado no SANE+ e nossa equipe de atendimento iniciará a análise. Você pode acompanhar e responder pelo app.\n\nAssunto: " +
        body.subject,
      userId: user.id,
      ticketId: created.id,
      complaintId: body.complaintId ?? null,
      meta: { type: "support_ticket_created", category },
    });
  }

  return NextResponse.json({ ok: true, id: created.id });
}
