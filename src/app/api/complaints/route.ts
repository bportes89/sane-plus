import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { autoModerate } from "@/lib/moderation";
import { slugify } from "@/lib/slug";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import {
  ComplaintCategory,
  ComplaintEventType,
  ComplaintStatus,
  ComplaintVisibility,
  ModerationActionType,
  NotificationType,
} from "@/generated/prisma/client";
import { addPoints } from "@/lib/badges";
import { runComplaintCreatedAutomations } from "@/lib/automation";
import { createAiModerationSuggestionForComplaint } from "@/lib/aiModeration";
import { publishIntegrationEvent, publishOfficialEmail } from "@/lib/integrations";

export async function GET() {
  const user = await requireUser();
  const items = await prisma.complaint.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      issue: true,
      status: true,
      createdAt: true,
      locationLat: true,
      locationLng: true,
      locationLabel: true,
      company: { select: { name: true } },
    },
  });
  return NextResponse.json(items);
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "content_type" }, { status: 415 });
  }

  const user = await requireUser();
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `complaints:create:${user.id}:${ip}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | {
        companyName?: string;
        category?: string;
        subcategory?: string;
        issue?: string;
        description?: string;
        neighborhood?: string;
        street?: string;
        number?: string;
        locationLat?: number;
        locationLng?: number;
        locationLabel?: string;
        visibility?: string;
      }
    | null;

  if (!body?.companyName || !body?.description) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const company = await prisma.company.upsert({
    where: { slug: slugify(body.companyName) },
    create: {
      name: body.companyName,
      slug: slugify(body.companyName),
    },
    update: {},
  });

  const moderated = autoModerate(body.description);
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

  const visibility =
    body.visibility === "privada" || body.visibility === "PRIVATE"
      ? ComplaintVisibility.PRIVATE
      : body.visibility === "anonimizada" || body.visibility === "ANONYMIZED"
        ? ComplaintVisibility.ANONYMIZED
        : ComplaintVisibility.PUBLIC;

  const status =
    moderated.severity === "review" ? ComplaintStatus.NEEDS_REVIEW : ComplaintStatus.PUBLISHED;
  const finalVisibility =
    moderated.severity === "review" ? ComplaintVisibility.PRIVATE : visibility;

  const complaint = await prisma.complaint.create({
    data: {
      userId: user.id,
      companyId: company.id,
      category:
        body.category === "Água"
          ? ComplaintCategory.WATER
          : body.category === "Esgoto"
            ? ComplaintCategory.SEWER
            : body.category === "Infraestrutura"
              ? ComplaintCategory.INFRASTRUCTURE
              : body.category === "Financeiro"
                ? ComplaintCategory.FINANCIAL
                : ComplaintCategory.SERVICE,
      subcategory: body.subcategory ?? null,
      issue: body.issue ?? "Problema",
      description: moderated.output,
      neighborhood: body.neighborhood ?? null,
      street: body.street ?? null,
      number: body.number ?? null,
      locationLat: body.locationLat ?? null,
      locationLng: body.locationLng ?? null,
      locationLabel: body.locationLabel ?? null,
      status,
      visibility: finalVisibility,
      events: {
        create: [
          {
            type: ComplaintEventType.REGISTERED,
            message: "Sua reclamação foi registrada.",
          },
          ...(status === ComplaintStatus.NEEDS_REVIEW
            ? [
                {
                  type: ComplaintEventType.CONTENT_ADJUSTED,
                  message: "Sua reclamação está em análise.",
                },
              ]
            : []),
          ...(moderated.adjusted
            ? [
                {
                  type: ComplaintEventType.CONTENT_ADJUSTED,
                  message: "Seu conteúdo foi ajustado para atender às regras.",
                },
              ]
            : []),
          ...(status === ComplaintStatus.PUBLISHED
            ? [
                {
                  type: ComplaintEventType.PUBLISHED,
                  message: "Sua reclamação foi publicada.",
                },
              ]
            : []),
        ],
      },
    },
    select: { id: true, createdAt: true },
  });

  if (moderated.adjusted) {
    await prisma.moderationAction.create({
      data: {
        complaintId: complaint.id,
        moderatorId: null,
        action: ModerationActionType.EDITED,
        reason: "Auto-moderação",
        originalContent: { description: body.description, flags: moderated.flags },
        editedContent: { description: moderated.output, flags: moderated.flags },
        moderatorIp: req.headers.get("x-forwarded-for") ?? null,
      },
    });
  }

  const prefs = await prisma.user.findUnique({
    where: { id: user.id },
    select: { notifyInApp: true },
  });
  const canInApp = !prefs || prefs.notifyInApp;

  if (canInApp) {
    await prisma.notification.create({
      data: {
        userId: user.id,
        type: NotificationType.COMPLAINT_REGISTERED,
        title: "Reclamação registrada",
        message: "Sua reclamação foi registrada.",
      },
    });
    if (status === ComplaintStatus.NEEDS_REVIEW) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: NotificationType.MODERATION,
          title: "Reclamação em análise",
          message: "Sua reclamação foi retida para revisão antes de ser publicada.",
          actionUrl: `/complaints/${complaint.id}`,
        },
      });
    }
    if (moderated.adjusted) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: NotificationType.CONTENT_ADJUSTED,
          title: "Conteúdo ajustado",
          message: "Seu conteúdo foi ajustado para atender às regras.",
        },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "CREATE_COMPLAINT",
      tableName: "Complaint",
      recordId: complaint.id,
      newData: {
        companyId: company.id,
        category: body.category ?? null,
        subcategory: body.subcategory ?? null,
        issue: body.issue ?? "Problema",
        neighborhood: body.neighborhood ?? null,
        street: body.street ?? null,
        number: body.number ?? null,
        visibility: finalVisibility,
        status,
        moderated: moderated.flags,
      },
      ip: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
  });

  await addPoints(user.id, 5);

  try {
    await runComplaintCreatedAutomations(prisma, { complaintId: complaint.id });
  } catch (err) {
    void err;
  }

  try {
    await createAiModerationSuggestionForComplaint({
      prisma,
      complaintId: complaint.id,
      issue: body.issue ?? "Problema",
      description: moderated.output,
      category: body.category ?? null,
      subcategory: body.subcategory ?? null,
      visibility: finalVisibility,
    });
  } catch (err) {
    void err;
  }

  try {
    await publishIntegrationEvent({
      prisma,
      companyId: company.id,
      city: company.city ?? null,
      state: company.state ?? null,
      eventType: "complaint.created",
      payload: {
        complaintId: complaint.id,
        companyId: company.id,
        companyName: company.name,
        category: body.category ?? null,
        subcategory: body.subcategory ?? null,
        issue: body.issue ?? "Problema",
        status,
        visibility: finalVisibility,
        createdAt: complaint.createdAt.toISOString(),
      },
    });
    await publishOfficialEmail({
      prisma,
      companyId: company.id,
      city: company.city ?? null,
      state: company.state ?? null,
      subject: `Nova reclamação registrada — ${company.name}`,
      body: `Uma nova reclamação foi registrada.\n\nID: ${complaint.id}\nStatus: ${status}\nVisibilidade: ${finalVisibility}\nAssunto: ${body.issue ?? "Problema"}\n\nAcesse: ${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/complaints/${complaint.id}\n`,
      meta: { type: "complaint.created", complaintId: complaint.id },
    });
  } catch (err) {
    void err;
  }

  return NextResponse.json({ id: complaint.id });
}
