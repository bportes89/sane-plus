import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { autoModerateSupportMessage } from "@/lib/moderation";
import {
  ComplaintEventType,
  ComplaintStatus,
  ComplaintVisibility,
  ModerationActionType,
  NotificationType,
  UserRole,
} from "@/generated/prisma/client";
import type { NextRequest } from "next/server";
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

  if (user.role !== UserRole.COMPANY || !user.companyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ipClient = getClientIp(req.headers);
  const rl = rateLimit({
    key: `complaint:company-contest:${user.companyId}:${ipClient}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { message?: string; legalReason?: string }
    | null;
  if (!body?.message || body.message.trim().length < 10) {
    return NextResponse.json({ error: "Mensagem inválida" }, { status: 400 });
  }

  const complaint = await prisma.complaint.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      companyId: true,
      issue: true,
      description: true,
      status: true,
      visibility: true,
    },
  });
  if (!complaint) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (complaint.companyId !== user.companyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ip = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const reason = body.legalReason?.trim() ? body.legalReason.trim() : "Contestação da empresa";
  const moderated = autoModerateSupportMessage(body.message.trim());
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
  const message = moderated.output.trim();

  const moderation = await prisma.$transaction(async (tx) => {
    const created = await tx.moderationAction.create({
      data: {
        complaintId: complaint.id,
        moderatorId: null,
        action: ModerationActionType.HIDDEN,
        reason,
        details: message,
        originalContent: {
          issue: complaint.issue,
          description: complaint.description,
          status: complaint.status,
          visibility: complaint.visibility,
          source: "COMPANY_CONTESTATION",
        },
        editedContent: {
          requestedByCompanyId: user.companyId,
          moderated: moderated.flags,
        },
        moderatorIp: ip,
      },
      select: { id: true },
    });

    await tx.complaint.update({
      where: { id: complaint.id },
      data: {
        status: ComplaintStatus.NEEDS_REVIEW,
        visibility: ComplaintVisibility.PRIVATE,
        events: {
          create: {
            type: ComplaintEventType.CONTENT_ADJUSTED,
            message: "A empresa solicitou revisão jurídica do conteúdo.",
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
          title: "Revisão jurídica",
          message: "Sua reclamação foi ocultada para análise jurídica após contestação da empresa.",
          actionUrl: `/complaints/${complaint.id}`,
        },
      });
    }

    const companyRecipient = await tx.user.findUnique({
      where: { id: user.id },
      select: { notifyInApp: true },
    });
    if (!companyRecipient || companyRecipient.notifyInApp) {
      await tx.notification.create({
        data: {
          userId: user.id,
          type: NotificationType.SYSTEM,
          title: "Solicitação recebida",
          message: "Sua solicitação de contestação foi recebida.",
          actionUrl: `/company/complaints/${complaint.id}`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "COMPANY_CONTESTATION",
        tableName: "Complaint",
        recordId: complaint.id,
        newData: { complaintId: complaint.id, companyId: user.companyId, reason },
        ip,
        userAgent,
      },
    });

    return created;
  });

  return NextResponse.json({ ok: true, id: moderation.id });
}
