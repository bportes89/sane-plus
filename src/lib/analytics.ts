import type { PrismaClient } from "@/generated/prisma/client";
import {
  ComplaintCategory,
  ComplaintStatus,
  ComplaintVisibility,
  DataAlertScope,
  DataAlertType,
  EmailStatus,
  NotificationType,
  ReportScope,
  ReportType,
  UserRole,
  WebhookStatus,
} from "@/generated/prisma/client";

type Window = { from: Date; to: Date };

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function getWindowDays(raw: unknown, fallback: number) {
  const v = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return clampInt(v || fallback, 1, 365);
}

export function windowFromDays(windowDays: number, now = new Date()): Window {
  const days = clampInt(windowDays, 1, 365);
  const to = now;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

export function periodFromDate(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function parsePeriod(period: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const year = Number.parseInt(m[1] ?? "", 10);
  const month = Number.parseInt(m[2] ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function windowFromPeriod(period: string): Window | null {
  const parsed = parsePeriod(period);
  if (!parsed) return null;
  const from = new Date(Date.UTC(parsed.year, parsed.month - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(parsed.year, parsed.month, 1, 0, 0, 0, 0));
  return { from, to };
}

function resolveWindow(
  opts: { windowDays?: number; period?: string | null; now?: Date },
  fallbackDays: number,
) {
  const normalizedPeriod = typeof opts.period === "string" ? opts.period.trim() : "";
  if (normalizedPeriod) {
    const window = windowFromPeriod(normalizedPeriod);
    if (window) {
      return {
        from: window.from,
        to: window.to,
        period: normalizedPeriod,
        windowDays: Math.max(1, Math.round((window.to.getTime() - window.from.getTime()) / (24 * 60 * 60 * 1000))),
      };
    }
  }

  const now = opts.now ?? new Date();
  const windowDays = clampInt(opts.windowDays ?? fallbackDays, 1, 365);
  const window = windowFromDays(windowDays, now);
  return { from: window.from, to: window.to, period: null, windowDays };
}

export function quarterWindow(year: number, quarter: number): Window | null {
  const q = clampInt(quarter, 1, 4);
  const startMonth = (q - 1) * 3;
  const from = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, startMonth + 3, 1, 0, 0, 0, 0));
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return null;
  return { from, to };
}

function openStatuses() {
  return [
    ComplaintStatus.REGISTERED,
    ComplaintStatus.NEEDS_REVIEW,
    ComplaintStatus.PUBLISHED,
    ComplaintStatus.COMPANY_REPLIED,
    ComplaintStatus.USER_CONTESTED,
  ];
}

function countRecord(items: Array<{ key: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const i of items) out[i.key] = i.value;
  return out;
}

export async function computeCompanyDashboard(
  prisma: PrismaClient,
  opts: { companyId: string; windowDays?: number; period?: string | null; now?: Date },
) {
  const window = resolveWindow(opts, 30);
  const whereBase = { companyId: opts.companyId, createdAt: { gte: window.from, lte: window.to } };

  const [total, open, resolved, replied, contested, ratingAvg] = await prisma.$transaction([
    prisma.complaint.count({ where: whereBase }),
    prisma.complaint.count({ where: { ...whereBase, status: { in: openStatuses() } } }),
    prisma.complaint.count({ where: { ...whereBase, status: ComplaintStatus.RESOLVED } }),
    prisma.complaint.count({ where: { ...whereBase, responses: { some: {} } } }),
    prisma.complaint.count({ where: { ...whereBase, status: ComplaintStatus.USER_CONTESTED } }),
    prisma.companyRating.aggregate({
      where: { companyId: opts.companyId, createdAt: { gte: window.from, lte: window.to } },
      _avg: { score: true },
    }),
  ]);

  const byCategoryRaw = await prisma.complaint.groupBy({
    by: ["category"],
    where: whereBase,
    _count: true,
  });
  const byCategory = countRecord(
    byCategoryRaw.map((r) => ({ key: r.category, value: r._count })),
  );

  const byNeighborhoodRaw = await prisma.complaint.groupBy({
    by: ["neighborhood"],
    where: { ...whereBase, neighborhood: { not: null } },
    _count: true,
    orderBy: { _count: { id: "desc" } },
    take: 12,
  });
  const byNeighborhood = countRecord(
    byNeighborhoodRaw
      .filter((r) => r.neighborhood)
      .map((r) => ({ key: r.neighborhood ?? "", value: r._count })),
  );

  const recurring = (() => {
    const pairs = new Map<string, { neighborhood: string; category: ComplaintCategory; count: number }>();
    return prisma.complaint
      .findMany({
        where: { ...whereBase, neighborhood: { not: null } },
        select: { neighborhood: true, category: true },
        take: 5000,
      })
      .then((items) => {
        for (const c of items) {
          const nb = c.neighborhood?.trim();
          if (!nb) continue;
          const key = `${nb}::${c.category}`;
          const prev = pairs.get(key);
          pairs.set(key, {
            neighborhood: nb,
            category: c.category,
            count: (prev?.count ?? 0) + 1,
          });
        }
        return [...pairs.values()].filter((x) => x.count >= 2).sort((a, b) => b.count - a.count).slice(0, 20);
      });
  })();

  const [avgResponseMs, avgResolutionMs] = await Promise.all([
    prisma.complaint
      .findMany({
        where: { ...whereBase, responses: { some: {} } },
        select: {
          createdAt: true,
          responses: { take: 1, orderBy: { createdAt: "asc" }, select: { createdAt: true } },
        },
        take: 4000,
      })
      .then((items) => {
        const diffs = items
          .map((c) => {
            const first = c.responses[0]?.createdAt;
            if (!first) return null;
            return new Date(first).getTime() - new Date(c.createdAt).getTime();
          })
          .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0);
        if (!diffs.length) return null;
        return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
      }),
    prisma.complaint
      .findMany({
        where: { ...whereBase, resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
        take: 4000,
      })
      .then((items) => {
        const diffs = items
          .map((c) => {
            const r = c.resolvedAt;
            if (!r) return null;
            return new Date(r).getTime() - new Date(c.createdAt).getTime();
          })
          .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0);
        if (!diffs.length) return null;
        return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
      }),
  ]);

  const averageScore =
    typeof ratingAvg._avg.score === "number" ? Math.round(ratingAvg._avg.score * 10) / 10 : null;
  const responseRate = total ? Math.round((replied / total) * 100) : 0;
  const solutionRate = total ? Math.round((resolved / total) * 100) : 0;

  return {
    period: window.period,
    windowDays: window.windowDays,
    total,
    open,
    resolved,
    replied,
    contested,
    responseRate,
    solutionRate,
    avgResponseMs,
    avgResolutionMs,
    averageScore,
    byCategory,
    byNeighborhood,
    recurring: await recurring,
  };
}

export async function computeCityDashboard(
  prisma: PrismaClient,
  opts: { city: string; state: string; windowDays?: number; period?: string | null; now?: Date },
) {
  const window = resolveWindow(opts, 30);
  const whereBase = {
    createdAt: { gte: window.from, lte: window.to },
    company: { is: { city: opts.city, state: opts.state } },
  } as const;

  const [total, open, resolved, replied, contested] = await prisma.$transaction([
    prisma.complaint.count({ where: whereBase }),
    prisma.complaint.count({ where: { ...whereBase, status: { in: openStatuses() } } }),
    prisma.complaint.count({ where: { ...whereBase, status: ComplaintStatus.RESOLVED } }),
    prisma.complaint.count({ where: { ...whereBase, responses: { some: {} } } }),
    prisma.complaint.count({ where: { ...whereBase, status: ComplaintStatus.USER_CONTESTED } }),
  ]);

  const byCategoryRaw = await prisma.complaint.groupBy({
    by: ["category"],
    where: whereBase,
    _count: true,
  });
  const byCategory = countRecord(
    byCategoryRaw.map((r) => ({ key: r.category, value: r._count })),
  );

  const byNeighborhoodRaw = await prisma.complaint.groupBy({
    by: ["neighborhood"],
    where: { ...whereBase, neighborhood: { not: null } },
    _count: true,
    orderBy: { _count: { id: "desc" } },
    take: 12,
  });
  const byNeighborhood = countRecord(
    byNeighborhoodRaw
      .filter((r) => r.neighborhood)
      .map((r) => ({ key: r.neighborhood ?? "", value: r._count })),
  );

  const companyRankSource = await prisma.company.findMany({
    where: { city: opts.city, state: opts.state, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      slug: true,
      city: true,
      state: true,
      logoUrl: true,
      status: true,
      complaints: {
        where: { createdAt: { gte: window.from, lte: window.to } },
        select: {
          id: true,
          status: true,
          createdAt: true,
          responses: { select: { createdAt: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  const companyRank = companyRankSource
    .map((company) => {
      const totalComplaints = company.complaints.length;
      const resolvedComplaints = company.complaints.filter((item) => item.status === ComplaintStatus.RESOLVED).length;
      const respondedComplaints = company.complaints.filter((item) => item.responses.length > 0);
      const avgResponseMs =
        respondedComplaints.length > 0
          ? Math.round(
              respondedComplaints
                .map((item) => item.responses[0]!.createdAt.getTime() - item.createdAt.getTime())
                .reduce((sum, value) => sum + value, 0) / respondedComplaints.length,
            )
          : null;
      const solutionRate = totalComplaints ? Math.round((resolvedComplaints / totalComplaints) * 100) : 0;
      const saneIndex =
        solutionRate +
        (avgResponseMs != null ? Math.max(0, 100 - Math.round(avgResponseMs / 360000)) : 50);

      return {
        id: company.id,
        name: company.name,
        slug: company.slug,
        city: company.city,
        state: company.state,
        logoUrl: company.logoUrl,
        status: company.status,
        total: totalComplaints,
        resolved: resolvedComplaints,
        solutionRate,
        avgResponseMs,
        saneIndex,
      };
    })
    .filter((company) => company.total > 0)
    .sort((a, b) => b.saneIndex - a.saneIndex || b.solutionRate - a.solutionRate || a.name.localeCompare(b.name));

  const recurringCount = await prisma.complaint
    .findMany({
      where: { ...whereBase, neighborhood: { not: null } },
      select: { neighborhood: true, category: true },
      take: 9000,
    })
    .then((items) => {
      const counts = new Map<string, number>();
      for (const c of items) {
        const nb = c.neighborhood?.trim();
        if (!nb) continue;
        const key = `${nb}::${c.category}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let pairs = 0;
      for (const v of counts.values()) {
        if (v >= 3) pairs += 1;
      }
      return pairs;
    });

  return {
    period: window.period,
    windowDays: window.windowDays,
    city: opts.city,
    state: opts.state,
    total,
    open,
    resolved,
    replied,
    contested,
    recurringCount,
    responseRate: total ? Math.round((replied / total) * 100) : 0,
    solutionRate: total ? Math.round((resolved / total) * 100) : 0,
    byCategory,
    byNeighborhood,
    companyRank,
  };
}

function avgDurationMs(rows: Array<{ createdAt: Date; sentAt: Date | null }>) {
  const diffs: number[] = [];
  for (const r of rows) {
    if (!r.sentAt) continue;
    const ms = r.sentAt.getTime() - r.createdAt.getTime();
    if (Number.isFinite(ms) && ms >= 0) diffs.push(ms);
  }
  if (!diffs.length) return null;
  return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
}

export async function computeInstitutionalDeliveryMetrics(
  prisma: PrismaClient,
  opts: {
    windowDays?: number;
    period?: string | null;
    city?: string | null;
    state?: string | null;
    companyId?: string | null;
    now?: Date;
  },
) {
  const window = resolveWindow(opts, 30);

  const integrationFilter: Record<string, string> = {};
  if (opts.companyId) integrationFilter.companyId = opts.companyId;
  if (opts.city) integrationFilter.city = opts.city;
  if (opts.state) integrationFilter.state = opts.state;

  const integrationClause =
    Object.keys(integrationFilter).length > 0
      ? { integration: { is: integrationFilter as unknown as object } }
      : {};

  const emailBaseWhere = {
    createdAt: { gte: window.from, lte: window.to },
    integrationId: { not: null },
    ...integrationClause,
  } as const;

  const webhookBaseWhere = {
    createdAt: { gte: window.from, lte: window.to },
    integrationId: { not: null },
    ...integrationClause,
  } as const;

  const [
    emailPending,
    emailSent,
    emailFailed,
    webhookPending,
    webhookSent,
    webhookFailed,
  ] = await prisma.$transaction([
    prisma.emailOutbox.count({ where: { ...emailBaseWhere, status: EmailStatus.PENDING } }),
    prisma.emailOutbox.count({ where: { ...emailBaseWhere, status: EmailStatus.SENT } }),
    prisma.emailOutbox.count({ where: { ...emailBaseWhere, status: EmailStatus.FAILED } }),
    prisma.webhookOutbox.count({ where: { ...webhookBaseWhere, status: WebhookStatus.PENDING } }),
    prisma.webhookOutbox.count({ where: { ...webhookBaseWhere, status: WebhookStatus.SENT } }),
    prisma.webhookOutbox.count({ where: { ...webhookBaseWhere, status: WebhookStatus.FAILED } }),
  ]);

  const [emailSentRows, webhookSentRows] = await prisma.$transaction([
    prisma.emailOutbox.findMany({
      where: { ...emailBaseWhere, status: EmailStatus.SENT },
      select: { createdAt: true, sentAt: true },
      orderBy: { sentAt: "desc" },
      take: 2000,
    }),
    prisma.webhookOutbox.findMany({
      where: { ...webhookBaseWhere, status: WebhookStatus.SENT },
      select: { createdAt: true, sentAt: true },
      orderBy: { sentAt: "desc" },
      take: 2000,
    }),
  ]);

  const emailRetriesLogs = await prisma.auditLog.findMany({
    where: {
      action: "RETRY_EMAIL_OUTBOX",
      tableName: "EmailOutbox",
      createdAt: { gte: window.from, lte: window.to },
    },
    select: { recordId: true },
    take: 2000,
  });
  const webhookRetriesLogs = await prisma.auditLog.findMany({
    where: {
      action: "RETRY_WEBHOOK_OUTBOX",
      tableName: "WebhookOutbox",
      createdAt: { gte: window.from, lte: window.to },
    },
    select: { recordId: true },
    take: 2000,
  });

  const emailRetryIds = Array.from(new Set(emailRetriesLogs.map((l) => l.recordId))).filter(Boolean);
  const webhookRetryIds = Array.from(new Set(webhookRetriesLogs.map((l) => l.recordId))).filter(Boolean);

  const emailRetries = emailRetryIds.length
    ? await prisma.emailOutbox.count({
        where: { id: { in: emailRetryIds }, integrationId: { not: null }, ...integrationClause },
      })
    : 0;
  const webhookRetries = webhookRetryIds.length
    ? await prisma.webhookOutbox.count({
        where: { id: { in: webhookRetryIds }, integrationId: { not: null }, ...integrationClause },
      })
    : 0;

  const emailAttempts = emailSent + emailFailed;
  const webhookAttempts = webhookSent + webhookFailed;

  return {
    period: window.period,
    windowDays: window.windowDays,
    from: window.from,
    to: window.to,
    filters: {
      city: opts.city ?? null,
      state: opts.state ?? null,
      companyId: opts.companyId ?? null,
    },
    email: {
      pending: emailPending,
      sent: emailSent,
      failed: emailFailed,
      retries: emailRetries,
      successRate: emailAttempts ? Math.round((emailSent / emailAttempts) * 100) : 0,
      avgSendMs: avgDurationMs(emailSentRows),
    },
    webhook: {
      pending: webhookPending,
      sent: webhookSent,
      failed: webhookFailed,
      retries: webhookRetries,
      successRate: webhookAttempts ? Math.round((webhookSent / webhookAttempts) * 100) : 0,
      avgSendMs: avgDurationMs(webhookSentRows),
    },
  };
}

export async function computePublicDashboard(
  prisma: PrismaClient,
  opts: { windowDays?: number; period?: string | null; now?: Date },
) {
  const window = resolveWindow(opts, 30);
  const publicStatuses: ComplaintStatus[] = [
    ComplaintStatus.PUBLISHED,
    ComplaintStatus.COMPANY_REPLIED,
    ComplaintStatus.USER_CONTESTED,
    ComplaintStatus.RESOLVED,
    ComplaintStatus.CLOSED,
  ];
  const whereBase = {
    createdAt: { gte: window.from, lte: window.to },
    visibility: { in: [ComplaintVisibility.PUBLIC, ComplaintVisibility.ANONYMIZED] },
    status: { in: publicStatuses },
  };

  const [total, resolved, replied] = await prisma.$transaction([
    prisma.complaint.count({ where: whereBase }),
    prisma.complaint.count({ where: { ...whereBase, status: ComplaintStatus.RESOLVED } }),
    prisma.complaint.count({ where: { ...whereBase, responses: { some: {} } } }),
  ]);

  const byCategoryRaw = await prisma.complaint.groupBy({
    by: ["category"],
    where: whereBase,
    _count: true,
  });
  const byCategory = countRecord(byCategoryRaw.map((r) => ({ key: r.category, value: r._count })));

  const topCompaniesSource = await prisma.company.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      slug: true,
      city: true,
      state: true,
      logoUrl: true,
      complaints: {
        where: {
          createdAt: { gte: window.from, lte: window.to },
          visibility: { in: [ComplaintVisibility.PUBLIC, ComplaintVisibility.ANONYMIZED] },
          status: { in: publicStatuses },
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          responses: { select: { createdAt: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  const topCompanies = topCompaniesSource
    .map((company) => {
      const totalComplaints = company.complaints.length;
      const resolvedComplaints = company.complaints.filter((item) => item.status === ComplaintStatus.RESOLVED).length;
      const respondedComplaints = company.complaints.filter((item) => item.responses.length > 0);
      const avgResponseMs =
        respondedComplaints.length > 0
          ? Math.round(
              respondedComplaints
                .map((item) => item.responses[0]!.createdAt.getTime() - item.createdAt.getTime())
                .reduce((sum, value) => sum + value, 0) / respondedComplaints.length,
            )
          : null;
      const solutionRate = totalComplaints ? Math.round((resolvedComplaints / totalComplaints) * 100) : 0;
      const saneIndex =
        solutionRate +
        (avgResponseMs != null ? Math.max(0, 100 - Math.round(avgResponseMs / 360000)) : 50);

      return {
        id: company.id,
        name: company.name,
        slug: company.slug,
        city: company.city,
        state: company.state,
        logoUrl: company.logoUrl,
        total: totalComplaints,
        resolved: resolvedComplaints,
        solutionRate,
        avgResponseMs,
        saneIndex,
      };
    })
    .filter((company) => company.total > 0)
    .sort((a, b) => b.saneIndex - a.saneIndex || b.solutionRate - a.solutionRate || a.name.localeCompare(b.name));

  return {
    period: window.period,
    windowDays: window.windowDays,
    total,
    resolved,
    replied,
    responseRate: total ? Math.round((replied / total) * 100) : 0,
    solutionRate: total ? Math.round((resolved / total) * 100) : 0,
    byCategory,
    topCompanies,
  };
}

export async function computeHeatmap(
  prisma: PrismaClient,
  opts: {
    windowDays: number;
    precision: number;
    companyId?: string;
    category?: ComplaintCategory;
    status?: ComplaintStatus;
    city?: string;
    state?: string;
    now?: Date;
  },
) {
  const now = opts.now ?? new Date();
  const window = windowFromDays(opts.windowDays, now);
  const precision = clampInt(opts.precision, 1, 4);
  const factor = 10 ** precision;

  const whereBase: Record<string, unknown> = {
    createdAt: { gte: window.from, lte: window.to },
    visibility: { in: [ComplaintVisibility.PUBLIC, ComplaintVisibility.ANONYMIZED] },
    status: { in: [ComplaintStatus.PUBLISHED, ComplaintStatus.COMPANY_REPLIED, ComplaintStatus.USER_CONTESTED, ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED] },
    locationLat: { not: null },
    locationLng: { not: null },
    ...(opts.companyId ? { companyId: opts.companyId } : {}),
    ...(opts.category ? { category: opts.category } : {}),
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.city && opts.state ? { company: { is: { city: opts.city, state: opts.state } } } : {}),
  };

  const items = await prisma.complaint.findMany({
    where: whereBase,
    select: { locationLat: true, locationLng: true },
    take: 9000,
  });

  const buckets = new Map<string, { lat: number; lng: number; count: number }>();
  for (const c of items) {
    const lat = typeof c.locationLat === "number" ? c.locationLat : null;
    const lng = typeof c.locationLng === "number" ? c.locationLng : null;
    if (lat == null || lng == null) continue;
    const latR = Math.round(lat * factor) / factor;
    const lngR = Math.round(lng * factor) / factor;
    const key = `${latR},${lngR}`;
    const prev = buckets.get(key);
    buckets.set(key, { lat: latR, lng: lngR, count: (prev?.count ?? 0) + 1 });
  }

  return [...buckets.values()].sort((a, b) => b.count - a.count);
}

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.LEGAL || role === UserRole.ADMIN;
}

export async function scanDataAlerts(
  prisma: PrismaClient,
  opts: { now?: Date; windowHours?: number },
) {
  const now = opts.now ?? new Date();
  const windowHours = clampInt(opts.windowHours ?? 48, 6, 168);
  const from = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const prevFrom = new Date(from.getTime() - windowHours * 60 * 60 * 1000);

  const companies = await prisma.company.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, city: true, state: true },
  });

  const created: Array<{ id: string; scope: DataAlertScope; companyId?: string | null; city?: string | null; state?: string | null }> = [];

  for (const c of companies) {
    const [curr, prev] = await prisma.$transaction([
      prisma.complaint.count({
        where: {
          companyId: c.id,
          createdAt: { gte: from, lte: now },
          status: { in: openStatuses() },
        },
      }),
      prisma.complaint.count({
        where: {
          companyId: c.id,
          createdAt: { gte: prevFrom, lte: from },
          status: { in: openStatuses() },
        },
      }),
    ]);

    const spike = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : curr >= 8 ? 100 : 0;
    if (curr - prev >= 5 && spike >= 40) {
      const fingerprint = `company:${c.id}:spike:${from.toISOString().slice(0, 10)}:${windowHours}`;
      const alert = await prisma.dataAlert.upsert({
        where: { fingerprint },
        create: {
          scope: DataAlertScope.COMPANY,
          type: DataAlertType.SPIKE,
          fingerprint,
          companyId: c.id,
          city: c.city ?? null,
          state: c.state ?? null,
          title: "Aumento repentino de reclamações",
          message: `Aumento de ${spike}% nas últimas ${windowHours}h (de ${prev} para ${curr}).`,
          severity: "medium",
          meta: { companyId: c.id, curr, prev, windowHours },
        },
        update: {},
        select: { id: true, scope: true, companyId: true, city: true, state: true },
      });
      created.push(alert);
    }
  }

  const contaminationItems = await prisma.complaint.findMany({
    where: {
      createdAt: { gte: from, lte: now },
      status: { in: openStatuses() },
      OR: [
        { issue: { contains: "contamin" } },
        { issue: { contains: "Contamin" } },
        { issue: { contains: "CONTAMIN" } },
        { description: { contains: "contamin" } },
        { description: { contains: "Contamin" } },
        { description: { contains: "CONTAMIN" } },
        { issue: { contains: "contaminação" } },
        { issue: { contains: "Contaminação" } },
        { description: { contains: "contaminação" } },
        { description: { contains: "Contaminação" } },
      ],
    },
    select: { id: true, companyId: true },
    take: 60,
  });

  for (const c of contaminationItems) {
    const fingerprint = `complaint:${c.id}:contamination:${from.toISOString().slice(0, 10)}`;
    const alert = await prisma.dataAlert.upsert({
      where: { fingerprint },
      create: {
        scope: DataAlertScope.INTERNAL,
        type: DataAlertType.CONTAMINATION,
        fingerprint,
        companyId: c.companyId,
        title: "Possível risco de contaminação",
        message: "Detectamos um relato com indício de contaminação e encaminhamos para moderação.",
        severity: "high",
        meta: { complaintId: c.id },
      },
      update: {},
      select: { id: true, scope: true, companyId: true, city: true, state: true },
    });
    created.push(alert);
  }

  const recentRecurring = await prisma.complaint.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), lte: now },
      neighborhood: { not: null },
      status: { in: openStatuses() },
    },
    select: { companyId: true, neighborhood: true, category: true },
    take: 9000,
  });

  const recurringCounts = new Map<string, { companyId: string; neighborhood: string; category: ComplaintCategory; count: number }>();
  for (const it of recentRecurring) {
    const neighborhood = it.neighborhood?.trim();
    if (!neighborhood) continue;
    const key = `${it.companyId}::${neighborhood}::${it.category}`;
    const prev = recurringCounts.get(key);
    recurringCounts.set(key, {
      companyId: it.companyId,
      neighborhood,
      category: it.category,
      count: (prev?.count ?? 0) + 1,
    });
  }
  const recurringTop = [...recurringCounts.values()].filter((x) => x.count >= 3).sort((a, b) => b.count - a.count).slice(0, 40);

  for (const r of recurringTop) {
    const fingerprint = `company:${r.companyId}:recurring:${r.neighborhood}:${r.category}:${now.toISOString().slice(0, 10)}`;
    const alert = await prisma.dataAlert.upsert({
      where: { fingerprint },
      create: {
        scope: DataAlertScope.COMPANY,
        type: DataAlertType.RECURRING,
        fingerprint,
        companyId: r.companyId,
        title: "Problema recorrente em um bairro",
        message: `${r.count} reclamações em 7 dias para ${r.category} em ${r.neighborhood}.`,
        severity: "medium",
        meta: r,
      },
      update: {},
      select: { id: true, scope: true, companyId: true, city: true, state: true },
    });
    created.push(alert);
  }

  for (const c of companies) {
    const metrics = await prisma.companyMetric.findMany({
      where: { companyId: c.id },
      orderBy: { calculatedAt: "desc" },
      take: 2,
      select: {
        period: true,
        complaintsReceived: true,
        complaintsResolved: true,
        avgResponseMs: true,
        averageScore: true,
        calculatedAt: true,
      },
    });
    if (metrics.length < 2) continue;
    const [curr, prev] = metrics;
    if (prev.complaintsReceived < 10) continue;

    const prevSolutionRate = prev.complaintsReceived
      ? Math.round((prev.complaintsResolved / prev.complaintsReceived) * 100)
      : 0;
    const currSolutionRate = curr.complaintsReceived
      ? Math.round((curr.complaintsResolved / curr.complaintsReceived) * 100)
      : 0;
    const solutionRateDrop = prevSolutionRate - currSolutionRate;

    const issues: string[] = [];
    if (solutionRateDrop >= 20 && prevSolutionRate >= 50) {
      issues.push(`Taxa de solução caiu de ${prevSolutionRate}% para ${currSolutionRate}%.`);
    }

    if (prev.avgResponseMs != null && curr.avgResponseMs != null && prev.avgResponseMs > 0) {
      const delta = curr.avgResponseMs - prev.avgResponseMs;
      if (delta >= 60 * 60 * 1000 && curr.avgResponseMs >= prev.avgResponseMs * 1.4) {
        const prevH = Math.round(prev.avgResponseMs / (60 * 60 * 1000));
        const currH = Math.round(curr.avgResponseMs / (60 * 60 * 1000));
        issues.push(`Tempo médio de resposta subiu de ~${prevH}h para ~${currH}h.`);
      }
    }

    if (prev.averageScore != null && curr.averageScore != null) {
      const scoreDrop = prev.averageScore - curr.averageScore;
      if (scoreDrop >= 0.8 && prev.averageScore >= 3) {
        issues.push(`Nota média caiu de ${prev.averageScore.toFixed(1)} para ${curr.averageScore.toFixed(1)}.`);
      }
    }

    if (issues.length) {
      const fingerprint = `company:${c.id}:performance:${prev.period}->${curr.period}`;
      const severity = solutionRateDrop >= 35 ? "high" : "medium";
      const alert = await prisma.dataAlert.upsert({
        where: { fingerprint },
        create: {
          scope: DataAlertScope.COMPANY,
          type: DataAlertType.PERFORMANCE_DROP,
          fingerprint,
          companyId: c.id,
          city: c.city ?? null,
          state: c.state ?? null,
          title: "Mudança relevante em métricas",
          message: issues.join(" "),
          severity,
          meta: {
            companyId: c.id,
            current: {
              period: curr.period,
              complaintsReceived: curr.complaintsReceived,
              complaintsResolved: curr.complaintsResolved,
              avgResponseMs: curr.avgResponseMs,
              averageScore: curr.averageScore,
              calculatedAt: curr.calculatedAt.toISOString(),
            },
            previous: {
              period: prev.period,
              complaintsReceived: prev.complaintsReceived,
              complaintsResolved: prev.complaintsResolved,
              avgResponseMs: prev.avgResponseMs,
              averageScore: prev.averageScore,
              calculatedAt: prev.calculatedAt.toISOString(),
            },
          },
        },
        update: {},
        select: { id: true, scope: true, companyId: true, city: true, state: true },
      });
      created.push(alert);
    }
  }

  const cityKeys = new Set<string>();
  for (const c of companies) {
    const city = c.city?.trim();
    const state = c.state?.trim();
    if (!city || !state) continue;
    cityKeys.add(`${city}||${state}`);
  }

  for (const k of cityKeys) {
    const [city, state] = k.split("||");
    if (!city || !state) continue;
    const metrics = await prisma.cityMetric.findMany({
      where: { city, state },
      orderBy: { calculatedAt: "desc" },
      take: 2,
      select: {
        period: true,
        complaintsTotal: true,
        complaintsResolved: true,
        avgResponseMs: true,
        solutionRate: true,
        calculatedAt: true,
      },
    });
    if (metrics.length < 2) continue;
    const [curr, prev] = metrics;
    if (prev.complaintsTotal < 20) continue;

    const prevSolutionRate = prev.solutionRate ?? (prev.complaintsTotal ? Math.round((prev.complaintsResolved / prev.complaintsTotal) * 100) : 0);
    const currSolutionRate = curr.solutionRate ?? (curr.complaintsTotal ? Math.round((curr.complaintsResolved / curr.complaintsTotal) * 100) : 0);
    const solutionRateDrop = prevSolutionRate - currSolutionRate;

    const issues: string[] = [];
    if (solutionRateDrop >= 15 && prevSolutionRate >= 45) {
      issues.push(`Taxa de solução caiu de ${prevSolutionRate}% para ${currSolutionRate}%.`);
    }

    if (prev.avgResponseMs != null && curr.avgResponseMs != null && prev.avgResponseMs > 0) {
      const delta = curr.avgResponseMs - prev.avgResponseMs;
      if (delta >= 60 * 60 * 1000 && curr.avgResponseMs >= prev.avgResponseMs * 1.3) {
        const prevH = Math.round(prev.avgResponseMs / (60 * 60 * 1000));
        const currH = Math.round(curr.avgResponseMs / (60 * 60 * 1000));
        issues.push(`Tempo médio de resposta subiu de ~${prevH}h para ~${currH}h.`);
      }
    }

    if (issues.length) {
      const fingerprint = `city:${city}:${state}:performance:${prev.period}->${curr.period}`;
      const severity = solutionRateDrop >= 30 ? "high" : "medium";
      const alert = await prisma.dataAlert.upsert({
        where: { fingerprint },
        create: {
          scope: DataAlertScope.CITY,
          type: DataAlertType.PERFORMANCE_DROP,
          fingerprint,
          city,
          state,
          title: "Mudança relevante em métricas da cidade",
          message: issues.join(" "),
          severity,
          meta: {
            city,
            state,
            current: {
              period: curr.period,
              complaintsTotal: curr.complaintsTotal,
              complaintsResolved: curr.complaintsResolved,
              avgResponseMs: curr.avgResponseMs,
              solutionRate: currSolutionRate,
              calculatedAt: curr.calculatedAt.toISOString(),
            },
            previous: {
              period: prev.period,
              complaintsTotal: prev.complaintsTotal,
              complaintsResolved: prev.complaintsResolved,
              avgResponseMs: prev.avgResponseMs,
              solutionRate: prevSolutionRate,
              calculatedAt: prev.calculatedAt.toISOString(),
            },
          },
        },
        update: {},
        select: { id: true, scope: true, companyId: true, city: true, state: true },
      });
      created.push(alert);
    }
  }

  const companyRecipients = new Map<string, string[]>();
  for (const a of created) {
    if (a.scope !== DataAlertScope.COMPANY || !a.companyId) continue;
    if (!companyRecipients.has(a.companyId)) companyRecipients.set(a.companyId, []);
    companyRecipients.get(a.companyId)?.push(a.id);
  }

  for (const [companyId, alertIds] of companyRecipients.entries()) {
    const users = await prisma.user.findMany({
      where: { role: UserRole.COMPANY, companyId, notifyInApp: true },
      select: { id: true },
    });
    if (!users.length) continue;
    await prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: NotificationType.ALERT,
        title: "Alerta SANE+",
        message: `Há ${alertIds.length} alerta(s) novo(s) sobre sua operação.`,
        actionUrl: "/company/dashboard",
      })),
    });
  }

  const staff = await prisma.user.findMany({
    where: { role: { in: [UserRole.ADMIN, UserRole.MODERATOR, UserRole.LEGAL] }, notifyInApp: true },
    select: { id: true },
  });
  if (staff.length) {
    const internalCount = created.filter((x) => x.scope === DataAlertScope.INTERNAL).length;
    const cityCount = created.filter((x) => x.scope === DataAlertScope.CITY).length;
    await prisma.notification.createMany({
      data: staff.map((u) => ({
        userId: u.id,
        type: NotificationType.ALERT,
        title: "Alertas internos",
        message: `Foram gerados ${internalCount} alerta(s) interno(s) e ${cityCount} alerta(s) de cidade.`,
        actionUrl: "/moderation",
      })),
    });
  }

  return {
    created: created.length,
  };
}

export async function buildReport(
  prisma: PrismaClient,
  opts:
    | { type: typeof ReportType.COMPANY_MONTHLY; companyId: string; period: string }
    | { type: typeof ReportType.CITY_MONTHLY; city: string; state: string; period: string }
    | { type: typeof ReportType.INSTITUTIONAL_MONTHLY; city: string; state: string; period: string }
    | { type: typeof ReportType.REGIONAL_QUARTERLY; state: string; year: number; quarter: number }
    | { type: typeof ReportType.INSTITUTIONAL_QUARTERLY; state: string; year: number; quarter: number }
    | { type: typeof ReportType.NATIONAL_ANNUAL; year: number }
    | { type: typeof ReportType.INSTITUTIONAL_ANNUAL; year: number },
) {
  if (opts.type === ReportType.COMPANY_MONTHLY) {
    const w = windowFromPeriod(opts.period);
    if (!w) return null;
    const company = await prisma.company.findUnique({
      where: { id: opts.companyId },
      select: { id: true, name: true, city: true, state: true },
    });
    if (!company) return null;

    const base = {
      companyId: opts.companyId,
      createdAt: { gte: w.from, lte: w.to },
    } as const;

    const [total, resolved, replied] = await prisma.$transaction([
      prisma.complaint.count({ where: base }),
      prisma.complaint.count({ where: { ...base, status: ComplaintStatus.RESOLVED } }),
      prisma.complaint.count({ where: { ...base, responses: { some: {} } } }),
    ]);
    const metric = await computeCompanyMetricForPeriod(prisma, { companyId: opts.companyId, period: opts.period });

    const byCategoryRaw = await prisma.complaint.groupBy({
      by: ["category"],
      where: base,
      _count: true,
    });
    const byCategory = countRecord(byCategoryRaw.map((r) => ({ key: r.category, value: r._count })));

    const byNeighborhoodRaw = await prisma.complaint.groupBy({
      by: ["neighborhood"],
      where: { ...base, neighborhood: { not: null } },
      _count: true,
      orderBy: { _count: { id: "desc" } },
      take: 15,
    });
    const byNeighborhood = byNeighborhoodRaw
      .filter((r) => r.neighborhood)
      .map((r) => ({ neighborhood: r.neighborhood ?? "", total: r._count }));

    const payload = {
      kind: "company_monthly",
      company: { id: company.id, name: company.name, city: company.city, state: company.state },
      period: opts.period,
      totals: {
        complaints: total,
        replied,
        resolved,
        responseRate: total ? Math.round((replied / total) * 100) : 0,
        solutionRate: total ? Math.round((resolved / total) * 100) : 0,
      },
      metrics: metric
        ? {
            complaintsReceived: metric.complaintsReceived,
            complaintsReplied: metric.complaintsReplied,
            complaintsResolved: metric.complaintsResolved,
            avgResponseMs: metric.avgResponseMs,
            averageScore: metric.averageScore,
          }
        : null,
      byCategory,
      byNeighborhood,
    };

    return { scope: ReportScope.COMPANY, period: opts.period, payload };
  }

  if (opts.type === ReportType.CITY_MONTHLY) {
    const w = windowFromPeriod(opts.period);
    if (!w) return null;
    const base = {
      createdAt: { gte: w.from, lte: w.to },
      company: { is: { city: opts.city, state: opts.state } },
    } as const;

    const [total, resolved, replied] = await prisma.$transaction([
      prisma.complaint.count({ where: base }),
      prisma.complaint.count({ where: { ...base, status: ComplaintStatus.RESOLVED } }),
      prisma.complaint.count({ where: { ...base, responses: { some: {} } } }),
    ]);

    const byCategoryRaw = await prisma.complaint.groupBy({
      by: ["category"],
      where: base,
      _count: true,
    });
    const byCategory = countRecord(byCategoryRaw.map((r) => ({ key: r.category, value: r._count })));

    const byNeighborhoodRaw = await prisma.complaint.groupBy({
      by: ["neighborhood"],
      where: { ...base, neighborhood: { not: null } },
      _count: true,
      orderBy: { _count: { id: "desc" } },
      take: 15,
    });
    const byNeighborhood = byNeighborhoodRaw
      .filter((r) => r.neighborhood)
      .map((r) => ({ neighborhood: r.neighborhood ?? "", total: r._count }));

    const companies = await prisma.company.findMany({
      where: { city: opts.city, state: opts.state },
      select: { id: true, name: true, overallScore: true, solutionRate: true, avgResponseMs: true },
      orderBy: [{ solutionRate: "desc" }, { overallScore: "desc" }, { name: "asc" }],
      take: 20,
    });

    const payload = {
      kind: "city_monthly",
      city: opts.city,
      state: opts.state,
      period: opts.period,
      totals: {
        complaints: total,
        replied,
        resolved,
        responseRate: total ? Math.round((replied / total) * 100) : 0,
        solutionRate: total ? Math.round((resolved / total) * 100) : 0,
      },
      byCategory,
      byNeighborhood,
      companyRanking: companies,
    };

    return { scope: ReportScope.CITY, period: opts.period, payload };
  }

  if (opts.type === ReportType.INSTITUTIONAL_MONTHLY) {
    const w = windowFromPeriod(opts.period);
    if (!w) return null;
    const { city, state, period } = opts;
    const base = {
      createdAt: { gte: w.from, lte: w.to },
      company: { is: { city, state } },
    } as const;
    const [total, resolved, replied] = await prisma.$transaction([
      prisma.complaint.count({ where: base }),
      prisma.complaint.count({ where: { ...base, status: ComplaintStatus.RESOLVED } }),
      prisma.complaint.count({ where: { ...base, responses: { some: {} } } }),
    ]);
    const byCategoryRaw = await prisma.complaint.groupBy({
      by: ["category"],
      where: base,
      _count: true,
    });
    const byCategory = countRecord(byCategoryRaw.map((r) => ({ key: r.category, value: r._count })));
    const byNeighborhoodRaw = await prisma.complaint.groupBy({
      by: ["neighborhood"],
      where: { ...base, neighborhood: { not: null } },
      _count: true,
      orderBy: { _count: { id: "desc" } },
      take: 15,
    });
    const byNeighborhood = byNeighborhoodRaw
      .filter((r) => r.neighborhood)
      .map((r) => ({ neighborhood: r.neighborhood ?? "", total: r._count }));
    const companies = await prisma.company.findMany({
      where: { city, state },
      select: { id: true, name: true, overallScore: true, solutionRate: true, avgResponseMs: true },
      orderBy: [{ solutionRate: "desc" }, { overallScore: "desc" }, { name: "asc" }],
      take: 20,
    });
    const payload = {
      kind: "institutional_monthly",
      city,
      state,
      period,
      totals: {
        complaints: total,
        replied,
        resolved,
        responseRate: total ? Math.round((replied / total) * 100) : 0,
        solutionRate: total ? Math.round((resolved / total) * 100) : 0,
      },
      byCategory,
      byNeighborhood,
      companyRanking: companies,
    };
    return { scope: ReportScope.CITY, period, payload };
  }

  if (opts.type === ReportType.REGIONAL_QUARTERLY) {
    const w = quarterWindow(opts.year, opts.quarter);
    if (!w) return null;
    const period = `${opts.year}-Q${clampInt(opts.quarter, 1, 4)}`;
    const base = {
      createdAt: { gte: w.from, lte: w.to },
      company: { is: { state: opts.state } },
    } as const;

    const total = await prisma.complaint.count({ where: base });

    const byCityRaw = await prisma.company.groupBy({
      by: ["city"],
      where: { state: opts.state, city: { not: null } },
      _count: true,
    });

    const companyCountByCity = countRecord(
      byCityRaw
        .filter((r) => r.city)
        .map((r) => ({ key: r.city ?? "", value: r._count })),
    );

    const byCategoryRaw = await prisma.complaint.groupBy({
      by: ["category"],
      where: base,
      _count: true,
    });
    const byCategory = countRecord(byCategoryRaw.map((r) => ({ key: r.category, value: r._count })));

    const companies = await prisma.company.findMany({
      where: { state: opts.state },
      select: { id: true, name: true, city: true, overallScore: true, solutionRate: true, avgResponseMs: true },
      orderBy: [{ solutionRate: "desc" }, { overallScore: "desc" }, { name: "asc" }],
      take: 30,
    });

    const payload = {
      kind: "regional_quarterly",
      state: opts.state,
      year: opts.year,
      quarter: clampInt(opts.quarter, 1, 4),
      period,
      totals: { complaints: total },
      byCategory,
      companies,
      companyCountByCity,
    };

    return { scope: ReportScope.REGION, period, payload };
  }

  if (opts.type === ReportType.INSTITUTIONAL_QUARTERLY) {
    const { state, year, quarter } = opts;
    const w = quarterWindow(year, quarter);
    if (!w) return null;
    const period = `${year}-Q${clampInt(quarter, 1, 4)}`;
    const base = {
      createdAt: { gte: w.from, lte: w.to },
      company: { is: { state } },
    } as const;
    const total = await prisma.complaint.count({ where: base });
    const byCityRaw = await prisma.company.groupBy({
      by: ["city"],
      where: { state, city: { not: null } },
      _count: true,
    });
    const companyCountByCity = countRecord(
      byCityRaw
        .filter((r) => r.city)
        .map((r) => ({ key: r.city ?? "", value: r._count })),
    );
    const byCategoryRaw = await prisma.complaint.groupBy({
      by: ["category"],
      where: base,
      _count: true,
    });
    const byCategory = countRecord(byCategoryRaw.map((r) => ({ key: r.category, value: r._count })));
    const companies = await prisma.company.findMany({
      where: { state },
      select: { id: true, name: true, city: true, overallScore: true, solutionRate: true, avgResponseMs: true },
      orderBy: [{ solutionRate: "desc" }, { overallScore: "desc" }, { name: "asc" }],
      take: 30,
    });
    const payload = {
      kind: "institutional_quarterly",
      state,
      year,
      quarter: clampInt(quarter, 1, 4),
      period,
      totals: { complaints: total },
      byCategory,
      companies,
      companyCountByCity,
    };
    return { scope: ReportScope.REGION, period, payload };
  }

  const period = String(opts.year);
  const from = new Date(Date.UTC(opts.year, 0, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(opts.year + 1, 0, 1, 0, 0, 0, 0));
  const base = { createdAt: { gte: from, lte: to } } as const;

  const [total, resolved] = await prisma.$transaction([
    prisma.complaint.count({ where: base }),
    prisma.complaint.count({ where: { ...base, status: ComplaintStatus.RESOLVED } }),
  ]);

  const byCategoryRaw = await prisma.complaint.groupBy({
    by: ["category"],
    where: base,
    _count: true,
  });
  const byCategory = countRecord(byCategoryRaw.map((r) => ({ key: r.category, value: r._count })));

  const companies = await prisma.company.findMany({
    select: { id: true, name: true, city: true, state: true, overallScore: true, solutionRate: true, avgResponseMs: true },
    orderBy: [{ solutionRate: "desc" }, { overallScore: "desc" }, { name: "asc" }],
    take: 50,
  });

  const payload = {
    kind: "national_annual",
    year: opts.year,
    period,
    totals: {
      complaints: total,
      resolved,
      solutionRate: total ? Math.round((resolved / total) * 100) : 0,
    },
    byCategory,
    companies,
  };

  if (opts.type === ReportType.INSTITUTIONAL_ANNUAL) {
    const instPayload = { ...payload, kind: "institutional_annual" };
    return { scope: ReportScope.NATIONAL, period, payload: instPayload };
  }

  return { scope: ReportScope.NATIONAL, period, payload };
}

export async function canAccessReports(user: { role: UserRole } | null, scope: ReportScope) {
  if (scope === ReportScope.PUBLIC) return true;
  if (!user) return false;
  if (scope === ReportScope.COMPANY) return user.role === UserRole.COMPANY;
  return isStaff(user.role);
}

export async function computeCompanyMetricForPeriod(
  prisma: PrismaClient,
  opts: { companyId: string; period: string; now?: Date },
) {
  const w = windowFromPeriod(opts.period);
  if (!w) return null;

  const base = { companyId: opts.companyId, createdAt: { gte: w.from, lte: w.to } } as const;

  const [received, replied, resolved, ratingAvg] = await prisma.$transaction([
    prisma.complaint.count({ where: base }),
    prisma.complaint.count({ where: { ...base, responses: { some: {} } } }),
    prisma.complaint.count({ where: { ...base, status: ComplaintStatus.RESOLVED } }),
    prisma.companyRating.aggregate({
      where: { companyId: opts.companyId, createdAt: { gte: w.from, lte: w.to } },
      _avg: { score: true },
    }),
  ]);

  const avgResponseMs = await prisma.complaint
    .findMany({
      where: { ...base, responses: { some: {} } },
      select: {
        createdAt: true,
        responses: { take: 1, orderBy: { createdAt: "asc" }, select: { createdAt: true } },
      },
      take: 4000,
    })
    .then((items) => {
      const diffs = items
        .map((c) => {
          const first = c.responses[0]?.createdAt;
          if (!first) return null;
          return new Date(first).getTime() - new Date(c.createdAt).getTime();
        })
        .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0);
      if (!diffs.length) return null;
      return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
    });

  const averageScore =
    typeof ratingAvg._avg.score === "number" ? Math.round(ratingAvg._avg.score * 10) / 10 : null;

  return {
    period: opts.period,
    complaintsReceived: received,
    complaintsReplied: replied,
    complaintsResolved: resolved,
    avgResponseMs,
    averageScore,
    calculatedAt: opts.now ?? new Date(),
  };
}

export async function computeCityMetricForPeriod(
  prisma: PrismaClient,
  opts: { city: string; state: string; period: string; now?: Date },
) {
  const w = windowFromPeriod(opts.period);
  if (!w) return null;

  const base = {
    createdAt: { gte: w.from, lte: w.to },
    company: { is: { city: opts.city, state: opts.state } },
  } as const;

  const [total, open, replied, resolved] = await prisma.$transaction([
    prisma.complaint.count({ where: base }),
    prisma.complaint.count({ where: { ...base, status: { in: openStatuses() } } }),
    prisma.complaint.count({ where: { ...base, responses: { some: {} } } }),
    prisma.complaint.count({ where: { ...base, status: ComplaintStatus.RESOLVED } }),
  ]);

  const avgResponseMs = await prisma.complaint
    .findMany({
      where: { ...base, responses: { some: {} } },
      select: {
        createdAt: true,
        responses: { take: 1, orderBy: { createdAt: "asc" }, select: { createdAt: true } },
      },
      take: 6000,
    })
    .then((items) => {
      const diffs = items
        .map((c) => {
          const first = c.responses[0]?.createdAt;
          if (!first) return null;
          return new Date(first).getTime() - new Date(c.createdAt).getTime();
        })
        .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0);
      if (!diffs.length) return null;
      return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
    });

  const avgResolutionMs = await prisma.complaint
    .findMany({
      where: { ...base, resolvedAt: { not: null } },
      select: { createdAt: true, resolvedAt: true },
      take: 6000,
    })
    .then((items) => {
      const diffs = items
        .map((c) => {
          const r = c.resolvedAt;
          if (!r) return null;
          return new Date(r).getTime() - new Date(c.createdAt).getTime();
        })
        .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0);
      if (!diffs.length) return null;
      return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
    });

  const byCategoryRaw = await prisma.complaint.groupBy({
    by: ["category"],
    where: base,
    _count: true,
  });
  const byCategory = countRecord(byCategoryRaw.map((r) => ({ key: r.category, value: r._count })));

  const byNeighborhoodRaw = await prisma.complaint.groupBy({
    by: ["neighborhood"],
    where: { ...base, neighborhood: { not: null } },
    _count: true,
    orderBy: { _count: { id: "desc" } },
    take: 50,
  });
  const byNeighborhood = countRecord(
    byNeighborhoodRaw
      .filter((r) => r.neighborhood)
      .map((r) => ({ key: r.neighborhood ?? "", value: r._count })),
  );

  const recurring = await prisma.complaint
    .findMany({
      where: { ...base, neighborhood: { not: null } },
      select: { neighborhood: true, category: true },
      take: 9000,
    })
    .then((items) => {
      const counts = new Map<string, number>();
      for (const c of items) {
        const nb = c.neighborhood?.trim();
        if (!nb) continue;
        const key = `${nb}::${c.category}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.values()].filter((x) => x >= 2).length;
    });

  return {
    city: opts.city,
    state: opts.state,
    period: opts.period,
    complaintsTotal: total,
    complaintsOpen: open,
    complaintsReplied: replied,
    complaintsResolved: resolved,
    recurringCount: recurring,
    avgResponseMs,
    avgResolutionMs,
    solutionRate: total ? Math.round((resolved / total) * 100) : 0,
    byCategory,
    byNeighborhood,
    calculatedAt: opts.now ?? new Date(),
  };
}
