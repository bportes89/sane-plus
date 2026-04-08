import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  ComplaintEventType,
  ComplaintStatus,
  NotificationType,
} from "@/generated/prisma/client";
import { addPoints } from "@/lib/badges";
import type { NextRequest } from "next/server";
import { runComplaintResolvedAutomations } from "@/lib/automation";
import { publishIntegrationEvent, publishOfficialEmail } from "@/lib/integrations";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  const c = await prisma.complaint.findUnique({
    where: { id, userId: user.id },
    select: { id: true, status: true, companyId: true, company: { select: { id: true, name: true, city: true, state: true } } },
  });
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.complaint.update({
    where: { id: c.id },
    data: {
      status: ComplaintStatus.RESOLVED,
      resolvedAt: new Date(),
      events: {
        create: {
          type: ComplaintEventType.MARKED_RESOLVED,
          message: "Sua reclamação foi marcada como resolvida.",
        },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "RESOLVE_COMPLAINT",
      tableName: "Complaint",
      recordId: c.id,
      newData: { status: ComplaintStatus.RESOLVED },
      ip: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
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
        type: NotificationType.COMPLAINT_RESOLVED,
        title: "Reclamação resolvida",
        message: "Sua reclamação foi marcada como resolvida.",
      },
    });
  }

  await addPoints(user.id, 3);

  try {
    await runComplaintResolvedAutomations(prisma, { complaintId: c.id });
  } catch (err) {
    void err;
  }

  try {
    const company = c.company;
    await publishIntegrationEvent({
      prisma,
      companyId: company.id,
      city: company.city ?? null,
      state: company.state ?? null,
      eventType: "complaint.resolved",
      payload: { complaintId: c.id, companyId: company.id, companyName: company.name, resolvedAt: new Date().toISOString() },
    });
    await publishOfficialEmail({
      prisma,
      companyId: company.id,
      city: company.city ?? null,
      state: company.state ?? null,
      subject: `Reclamação marcada como resolvida — ${company.name}`,
      body: `A reclamação ${c.id} foi marcada como resolvida pelo usuário.\n`,
      meta: { type: "complaint.resolved", complaintId: c.id },
    });
  } catch (err) {
    void err;
  }

  return NextResponse.json({ ok: true });
}
