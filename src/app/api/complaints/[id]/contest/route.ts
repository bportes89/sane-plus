import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ComplaintEventType, NotificationType } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";
import { autoModerateSupportMessage } from "@/lib/moderation";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";

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
  const rl = rateLimit({
    key: `complaint:contest:user:${user.id}:${ip}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }
  const body = (await req.json().catch(() => null)) as { message?: string } | null;
  if (!body?.message || body.message.trim().length < 5) {
    return NextResponse.json({ error: "Mensagem inválida" }, { status: 400 });
  }

  const moderated = autoModerateSupportMessage(body.message);
  if (
    moderated.flags.xss ||
    moderated.flags.crimeAccusation ||
    moderated.flags.hatefulOrSexual ||
    moderated.flags.sensitiveData
  ) {
    return NextResponse.json(
      {
        error:
          "Seu texto contém informações que não podem ser publicadas. Ajuste para continuar.",
        moderation: { flags: moderated.flags },
      },
      { status: 400 },
    );
  }

  const c = await prisma.complaint.findUnique({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.contestation.create({
    data: {
      complaintId: c.id,
      userId: user.id,
      message: moderated.output,
    },
  });
  await prisma.complaintEvent.create({
    data: {
      complaintId: c.id,
      type: ComplaintEventType.USER_CONTESTED,
      message: "Recebemos sua contestação.",
    },
  });
  const prefs = await prisma.user.findUnique({
    where: { id: user.id },
    select: { notifyInApp: true },
  });
  if (!prefs || prefs.notifyInApp) {
    await prisma.notification.create({
      data: {
        userId: user.id,
        type: NotificationType.CONTESTATION_RECEIVED,
        title: "Contestação registrada",
        message: "Recebemos sua contestação.",
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "CONTEST_COMPLAINT",
      tableName: "Complaint",
      recordId: c.id,
      newData: { message: moderated.output, moderated: moderated.flags },
      ip: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
