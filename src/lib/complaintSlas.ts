import type { PrismaClient } from "@/generated/prisma/client";
import {
  AutomationTrigger,
  ComplaintStatus,
  DataAlertScope,
  DataAlertType,
  NotificationType,
  UserRole,
} from "@/generated/prisma/client";
import { applyAutomationRules } from "@/lib/automationRules";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

function normalize(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUrgentText(input: string) {
  const t = normalize(input);
  const keys = ["contamin", "intoxic", "hospital", "crianca", "ceu aberto", "esgoto", "vazamento"];
  return keys.some((k) => t.includes(k));
}

export async function processComplaintSlas(
  prisma: PrismaClient,
  opts: {
    actor: { id: string; role: UserRole } | null;
    hoursCompanyFirstReply: number;
    hoursUrgentFirstReply: number;
    limit: number;
    dryRun: boolean;
    now?: Date;
    ip?: string | null;
    userAgent?: string | null;
  },
) {
  if (opts.actor && !isStaff(opts.actor.role)) {
    return { ok: false as const, error: "forbidden" as const };
  }

  const now = opts.now ?? new Date();
  const nowTs = now.getTime();
  const cutoff = new Date(nowTs - opts.hoursCompanyFirstReply * 60 * 60 * 1000);
  const urgentCutoff = new Date(nowTs - opts.hoursUrgentFirstReply * 60 * 60 * 1000);

  const overdue = await prisma.complaint.findMany({
    where: {
      status: { in: [ComplaintStatus.REGISTERED, ComplaintStatus.PUBLISHED, ComplaintStatus.USER_CONTESTED] },
      createdAt: { lte: cutoff },
      responses: { none: {} },
    },
    orderBy: { createdAt: "asc" },
    take: opts.limit,
    select: { id: true, companyId: true, issue: true, description: true, createdAt: true },
  });

  const overdueByCompany = new Map<string, { companyId: string; count: number; oldestAt: Date }>();
  for (const c of overdue) {
    const prev = overdueByCompany.get(c.companyId);
    if (!prev) {
      overdueByCompany.set(c.companyId, { companyId: c.companyId, count: 1, oldestAt: c.createdAt });
    } else {
      overdueByCompany.set(c.companyId, {
        companyId: c.companyId,
        count: prev.count + 1,
        oldestAt: c.createdAt < prev.oldestAt ? c.createdAt : prev.oldestAt,
      });
    }
  }

  const urgentCandidates = await prisma.complaint.findMany({
    where: {
      status: { in: [ComplaintStatus.REGISTERED, ComplaintStatus.PUBLISHED, ComplaintStatus.USER_CONTESTED] },
      createdAt: { lte: urgentCutoff },
      responses: { none: {} },
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(80, Math.min(800, opts.limit)),
    select: { id: true, companyId: true, issue: true, description: true, createdAt: true },
  });
  const urgent = urgentCandidates.filter((c) => isUrgentText(`${c.issue} ${c.description}`)).slice(0, 80);

  if (!opts.dryRun) {
    const companies = [...overdueByCompany.values()];
    const companyUsers = await prisma.user.findMany({
      where: { role: UserRole.COMPANY, companyId: { in: companies.map((c) => c.companyId) }, notifyInApp: true },
      select: { id: true, companyId: true },
    });
    const staff = await prisma.user.findMany({
      where: { role: { in: [UserRole.ADMIN, UserRole.MODERATOR, UserRole.LEGAL] }, notifyInApp: true },
      select: { id: true },
    });

    const staffIds = staff.map((s) => s.id);
    const dateKey = now.toISOString().slice(0, 10);

    await prisma.$transaction(async (tx) => {
      for (const c of companies) {
        const fingerprint = `sla:company_first_reply:${c.companyId}:${dateKey}:${opts.hoursCompanyFirstReply}`;
        await tx.dataAlert.upsert({
          where: { fingerprint },
          create: {
            scope: DataAlertScope.COMPANY,
            type: DataAlertType.PERFORMANCE_DROP,
            fingerprint,
            companyId: c.companyId,
            title: "SLA: reclamações sem resposta",
            message: `${c.count} reclamação(ões) sem resposta há mais de ${opts.hoursCompanyFirstReply}h.`,
            severity: c.count >= 6 ? "high" : "medium",
            meta: { companyId: c.companyId, count: c.count, hoursCompanyFirstReply: opts.hoursCompanyFirstReply },
          },
          update: {},
        });
      }

      const byCompanyUser = new Map<string, string[]>();
      for (const u of companyUsers) {
        const k = u.companyId ?? "";
        const arr = byCompanyUser.get(k) ?? [];
        arr.push(u.id);
        byCompanyUser.set(k, arr);
      }

      for (const c of companies) {
        const ids = byCompanyUser.get(c.companyId) ?? [];
        if (!ids.length) continue;
        await tx.notification.createMany({
          data: ids.map((uid) => ({
            userId: uid,
            type: NotificationType.ALERT,
            title: "SLA: reclamações sem resposta",
            message: `${c.count} reclamação(ões) estão sem resposta há mais de ${opts.hoursCompanyFirstReply}h.`,
            actionUrl: "/company/dashboard",
          })),
        });
      }

      if (urgent.length && staffIds.length) {
        await tx.notification.createMany({
          data: staffIds.map((sid) => ({
            userId: sid,
            type: NotificationType.ALERT,
            title: "SLA: casos urgentes sem resposta",
            message: `${urgent.length} caso(s) urgente(s) estão sem resposta há mais de ${opts.hoursUrgentFirstReply}h.`,
            actionUrl: "/alerts",
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          userId: opts.actor?.id ?? null,
          action: "PROCESS_COMPLAINT_SLAS",
          tableName: "Complaint",
          recordId: "batch",
          newData: {
            hoursCompanyFirstReply: opts.hoursCompanyFirstReply,
            hoursUrgentFirstReply: opts.hoursUrgentFirstReply,
            overdue: overdue.length,
            companies: companies.length,
            urgent: urgent.length,
            dry: false,
          },
          ip: opts.ip ?? null,
          userAgent: opts.userAgent ?? null,
        },
      });
    });

    try {
      await applyAutomationRules(prisma, {
        trigger: AutomationTrigger.COMPLAINT_SLA_CHECK,
        actor: opts.actor,
        context: {
          hoursCompanyFirstReply: opts.hoursCompanyFirstReply,
          hoursUrgentFirstReply: opts.hoursUrgentFirstReply,
          overdueCount: overdue.length,
          urgentCount: urgent.length,
          companiesCount: overdueByCompany.size,
        },
      });
    } catch (err) {
      void err;
    }
  }

  return {
    ok: true as const,
    preview: opts.dryRun,
    counts: {
      overdue: overdue.length,
      companies: overdueByCompany.size,
      urgent: urgent.length,
    },
    settings: { hoursCompanyFirstReply: opts.hoursCompanyFirstReply, hoursUrgentFirstReply: opts.hoursUrgentFirstReply },
  };
}
