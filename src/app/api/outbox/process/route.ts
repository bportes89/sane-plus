import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { EmailStatus, UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";
import { sendEmailUsingProvider } from "@/lib/mailer";

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

  const body = (await req.json().catch(() => null)) as { limit?: number; dryRun?: boolean } | null;
  const limit = Math.max(1, Math.min(50, typeof body?.limit === "number" ? body.limit : 10));
  const dry = !!body?.dryRun;

  const now = new Date();

  const pending = await prisma.emailOutbox.findMany({
    where: { status: EmailStatus.PENDING },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, to: true, subject: true, body: true },
  });

  if (!pending.length) return NextResponse.json({ ok: true, processed: 0 });

  let sent = 0;
  let failed = 0;

  await prisma.$transaction(async (tx) => {
    for (const item of pending) {
      if (dry) {
        await tx.emailOutbox.update({
          where: { id: item.id },
          data: { status: EmailStatus.SENT, sentAt: now, error: null },
        });
        sent += 1;
        continue;
      }

      const result = await sendEmailUsingProvider({
        to: item.to,
        subject: item.subject,
        text: item.body,
      });
      if (result.ok) {
        await tx.emailOutbox.update({
          where: { id: item.id },
          data: { status: EmailStatus.SENT, sentAt: now, error: null },
        });
        sent += 1;
      } else {
        await tx.emailOutbox.update({
          where: { id: item.id },
          data: { status: EmailStatus.FAILED, error: result.error ?? "Falha desconhecida" },
        });
        failed += 1;
      }
    }

    await tx.auditLog.create({
      data: {
        userId: user?.id ?? null,
        action: "PROCESS_EMAIL_OUTBOX",
        tableName: "EmailOutbox",
        recordId: "batch",
        newData: { processed: pending.length, sent, failed, dry },
        ip: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });
  });

  return NextResponse.json({ ok: true, processed: pending.length, sent, failed, dry });
}
