import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { autoModerate } from "@/lib/moderation";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import {
  CompanyStatus,
  ComplaintEventType,
  ComplaintStatus,
  CompanyResponseStatus,
  ModerationActionType,
  NotificationType,
  UserRole,
} from "@/generated/prisma/client";
import type { NextRequest } from "next/server";
import { runCompanyResponseAutomations } from "@/lib/automation";
import { createAiModerationSuggestionForCompanyResponse } from "@/lib/aiModeration";
import { publishIntegrationEvent, publishOfficialEmail } from "@/lib/integrations";

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

  const ip = getClientIp(req.headers);
  const rl = rateLimit({
    key: `complaint:response:${user.companyId}:${ip}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { message?: string; authorName?: string }
    | null;
  if (!body?.message || body.message.trim().length < 5) {
    return NextResponse.json({ error: "Mensagem inválida" }, { status: 400 });
  }

  const moderated = autoModerate(body.message);
  if (moderated.severity === "block") {
    return NextResponse.json(
      {
        error:
          "Seu texto contém informações que não podem ser publicadas. Ajuste para continuar.",
        moderation: {
          severity: moderated.severity,
          flags: moderated.flags,
        },
      },
      { status: 400 },
    );
  }

  const complaint = await prisma.complaint.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      status: true,
      company: { select: { id: true, name: true, status: true, city: true, state: true } },
    },
  });
  if (!complaint) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (complaint.company.id !== user.companyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (complaint.company.status !== CompanyStatus.ACTIVE) {
    return NextResponse.json({ error: "Empresa suspensa" }, { status: 403 });
  }
  const openStatuses: ComplaintStatus[] = [
    ComplaintStatus.REGISTERED,
    ComplaintStatus.PUBLISHED,
    ComplaintStatus.USER_CONTESTED,
  ];
  if (!openStatuses.includes(complaint.status)) {
    return NextResponse.json(
      { error: "Reclamação não está aberta" },
      { status: 400 },
    );
  }

  const ipAudit = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;
  const now = new Date();

  const response = await prisma.companyResponse.create({
    data: {
      complaintId: complaint.id,
      companyId: user.companyId,
      authorName: body.authorName?.trim() ? body.authorName.trim() : null,
      message: moderated.output.trim(),
      status:
        moderated.severity === "review"
          ? CompanyResponseStatus.UNDER_REVIEW
          : CompanyResponseStatus.VISIBLE,
      createdAt: now,
    },
    select: { id: true },
  });

  if (moderated.adjusted || moderated.severity === "review") {
    await prisma.moderationAction.create({
      data: {
        complaintId: complaint.id,
        moderatorId: null,
        action:
          moderated.severity === "review"
            ? ModerationActionType.HIDDEN
            : ModerationActionType.EDITED,
        reason: "Auto-moderação (resposta da empresa)",
        originalContent: { response: body.message.trim(), flags: moderated.flags },
        editedContent: { response: moderated.output.trim(), flags: moderated.flags },
        moderatorIp: ipAudit,
      },
    });
  }

  const eventMessage =
    moderated.severity === "review"
      ? "A empresa enviou uma resposta e ela está em análise."
      : "A empresa respondeu sua reclamação.";

  await prisma.$transaction(async (tx) => {
    await tx.complaint.update({
      where: { id: complaint.id },
      data: {
        status: ComplaintStatus.COMPANY_REPLIED,
        events: {
          create: {
            type: ComplaintEventType.COMPANY_REPLIED,
            message: eventMessage,
          },
        },
      },
    });

    const recipient = await tx.user.findUnique({
      where: { id: complaint.userId },
      select: { notifyInApp: true },
    });
    if (!recipient || recipient.notifyInApp) {
      await tx.notification.create({
        data: {
          userId: complaint.userId,
          type: NotificationType.COMPANY_REPLIED,
          title: "Empresa respondeu",
          message: eventMessage,
          actionUrl: `/complaints/${complaint.id}`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "COMPANY_REPLY",
        tableName: "CompanyResponse",
        recordId: response.id,
        newData: {
          complaintId: complaint.id,
          companyId: user.companyId,
          moderated: moderated.flags,
        },
        ip: ipAudit,
        userAgent,
      },
    });
  });

  try {
    await runCompanyResponseAutomations(prisma, {
      complaintId: complaint.id,
      responseId: response.id,
      responseStatus: moderated.severity === "review" ? "UNDER_REVIEW" : "VISIBLE",
    });
  } catch (err) {
    void err;
  }

  if (moderated.severity === "review") {
    try {
      await createAiModerationSuggestionForCompanyResponse({
        prisma,
        responseId: response.id,
        complaintId: complaint.id,
        message: moderated.output.trim(),
      });
    } catch (err) {
      void err;
    }
  }

  try {
    const company = complaint.company;
    await publishIntegrationEvent({
      prisma,
      companyId: company.id,
      city: company.city ?? null,
      state: company.state ?? null,
      eventType: "company_response.created",
      payload: {
        complaintId: complaint.id,
        responseId: response.id,
        companyId: company.id,
        companyName: company.name,
        responseStatus: moderated.severity === "review" ? "UNDER_REVIEW" : "VISIBLE",
        createdAt: now.toISOString(),
      },
    });
    await publishOfficialEmail({
      prisma,
      companyId: company.id,
      city: company.city ?? null,
      state: company.state ?? null,
      subject: `Resposta enviada — ${company.name}`,
      body: `Uma resposta foi enviada pela empresa.\n\nReclamação: ${complaint.id}\nResposta: ${response.id}\nStatus: ${moderated.severity === "review" ? "UNDER_REVIEW" : "VISIBLE"}\n`,
      meta: { type: "company_response.created", complaintId: complaint.id, responseId: response.id },
    });
  } catch (err) {
    void err;
  }

  return NextResponse.json({ ok: true, id: response.id });
}
