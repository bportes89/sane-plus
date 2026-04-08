import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { NotificationType, SupportTicketStatus, UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";
import { queueEmail } from "@/lib/outbox";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret");
  const isCron = !!cronSecret && !!provided && provided === cronSecret;

  const user = isCron ? null : await requireUser();
  if (!isCron && (!user || !isStaff(user.role))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | { limit?: number; dryRun?: boolean; hoursFirstReply?: number; daysUserReminder?: number; daysAutoClose?: number }
    | null;
  const limit = Math.max(1, Math.min(100, body?.limit ?? 30));
  const dry = !!body?.dryRun;
  const hoursFirstReply = Math.max(1, Math.min(168, body?.hoursFirstReply ?? 48));
  const daysUserReminder = Math.max(1, Math.min(30, body?.daysUserReminder ?? 7));
  const daysAutoClose = Math.max(1, Math.min(60, body?.daysAutoClose ?? 14));

  const nowTs = Date.now();
  const now = new Date();
  const cutoffFirstReply = new Date(nowTs - hoursFirstReply * 60 * 60 * 1000);
  const cutoffUserReminder = new Date(nowTs - daysUserReminder * 24 * 60 * 60 * 1000);
  const cutoffAutoClose = new Date(nowTs - daysAutoClose * 24 * 60 * 60 * 1000);

  const overdueFirstReply = await prisma.supportTicket.findMany({
    where: {
      status: { in: [SupportTicketStatus.OPEN, SupportTicketStatus.PENDING_SUPPORT] },
      firstStaffReplyAt: null,
      firstReplySlaAlertedAt: null,
      createdAt: { lte: cutoffFirstReply },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, subject: true },
  });

  const pendingUser = await prisma.supportTicket.findMany({
    where: {
      status: SupportTicketStatus.PENDING_USER,
      updatedAt: { lte: cutoffUserReminder },
      OR: [{ lastUserReminderAt: null }, { lastUserReminderAt: { lte: cutoffUserReminder } }],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: {
      id: true,
      subject: true,
      updatedAt: true,
      user: { select: { id: true, email: true, notifyEmail: true, notifyInApp: true } },
    },
  });

  const autoClose = await prisma.supportTicket.findMany({
    where: {
      status: SupportTicketStatus.PENDING_USER,
      updatedAt: { lte: cutoffAutoClose },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: {
      id: true,
      subject: true,
      user: { select: { id: true, email: true, notifyEmail: true, notifyInApp: true } },
    },
  });

  if (!dry) {
    const staffUsers = await prisma.user.findMany({
      where: { role: { in: [UserRole.MODERATOR, UserRole.ADMIN, UserRole.LEGAL] } },
      select: { id: true, notifyInApp: true },
    });
    const staffIds = staffUsers.filter((s) => s.notifyInApp).map((s) => s.id);

    await prisma.$transaction(async (tx) => {
      for (const t of overdueFirstReply) {
        if (staffIds.length) {
          await tx.notification.createMany({
            data: staffIds.map((sid) => ({
              userId: sid,
              type: NotificationType.ALERT,
              title: "SLA: chamado sem primeira resposta",
              message: `O chamado "${t.subject}" está sem resposta inicial.`,
              actionUrl: `/support/admin/${t.id}`,
            })),
          });
        }
        await tx.supportTicket.update({
          where: { id: t.id },
          data: { firstReplySlaAlertedAt: now },
        });
      }

      for (const t of pendingUser) {
        if (t.user?.notifyEmail || t.user?.notifyInApp) {
          await tx.supportTicket.update({
            where: { id: t.id },
            data: { lastUserReminderAt: now },
          });
        }
        if (t.user?.notifyInApp) {
          await tx.notification.create({
            data: {
              userId: t.user.id,
              type: NotificationType.SYSTEM,
              title: "Precisamos da sua resposta",
              message: "Precisamos da sua resposta para continuar seu atendimento.",
              actionUrl: `/support/chat/${t.id}`,
            },
          });
        }
      }

      for (const t of autoClose) {
        await tx.supportTicket.update({
          where: { id: t.id },
          data: {
            status: SupportTicketStatus.CLOSED,
            closedAt: now,
          },
        });
        if (t.user?.notifyInApp) {
          await tx.notification.create({
            data: {
              userId: t.user.id,
              type: NotificationType.SYSTEM,
              title: "Chamado encerrado por inatividade",
              message: "Encerramos seu chamado por inatividade. Se precisar, você pode responder para reabrir.",
              actionUrl: `/support/chat/${t.id}`,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          userId: user?.id ?? null,
          action: "PROCESS_SUPPORT_SLAS",
          tableName: "SupportTicket",
          recordId: "batch",
          newData: {
            overdueFirstReply: overdueFirstReply.length,
            pendingUser: pendingUser.length,
            autoClose: autoClose.length,
            hoursFirstReply,
            daysUserReminder,
            daysAutoClose,
            dry: false,
          },
          ip: req.headers.get("x-forwarded-for") ?? null,
          userAgent: req.headers.get("user-agent") ?? null,
        },
      });
    });

    for (const t of pendingUser) {
      if (t.user?.email && t.user.notifyEmail) {
        await queueEmail({
          to: t.user.email,
          subject: "SANE+ • Precisamos da sua resposta",
          body:
            "Olá! Precisamos da sua resposta para continuar seu atendimento no SANE+. Acesse o app e responda no chamado.\n\nAssunto: " +
            (t.subject ?? ""),
          userId: t.user.id,
          ticketId: t.id,
          meta: { type: "support_user_reminder" },
        });
      }
    }

    for (const t of autoClose) {
      if (t.user?.email && t.user.notifyEmail) {
        await queueEmail({
          to: t.user.email,
          subject: "SANE+ • Chamado encerrado por inatividade",
          body:
            "Encerramos seu chamado por inatividade prolongada. Se ainda precisar, basta abrir um novo chamado ou responder no histórico para reabrir.",
          userId: t.user.id,
          ticketId: t.id,
          meta: { type: "support_auto_close" },
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    preview: dry,
    counts: {
      overdueFirstReply: overdueFirstReply.length,
      pendingUser: pendingUser.length,
      autoClose: autoClose.length,
    },
  });
}
