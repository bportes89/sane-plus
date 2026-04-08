import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import {
  AutomationTrigger,
  JobRunStatus,
  NotificationType,
  PipelineDataset,
  ReportScope,
  ReportType,
  UserRole,
} from "@/generated/prisma/client";
import {
  buildReport,
  computeCityMetricForPeriod,
  computeCompanyMetricForPeriod,
} from "@/lib/analytics";
import { createPipelineSnapshotIfChanged, prunePipelineSnapshotsByAge, sha256OfJson } from "@/lib/pipeline";
import { applyAutomationRules } from "@/lib/automationRules";
import {
  publishIntegrationEvent,
  publishIntegrationEventToCityScope,
  publishOfficialEmail,
  publishOfficialEmailToCityScope,
} from "@/lib/integrations";

export const dynamic = "force-dynamic";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function computeBackoffMs(retryIndex: number) {
  const base = 350;
  const max = 3_000;
  const raw = Math.min(max, base * 2 ** Math.max(0, retryIndex));
  const jitter = Math.floor(Math.random() * 150);
  return raw + jitter;
}

function isUniqueConstraintError(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "P2002";
}

async function safeCreatePipelineEvent(args: Parameters<typeof prisma.pipelineEvent.create>[0]) {
  try {
    await prisma.pipelineEvent.create(args);
  } catch (err) {
    if (isUniqueConstraintError(err)) return;
    throw err;
  }
}

function isCronRequest(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const provided = req.headers.get("x-cron-secret");
  if (provided && provided === cronSecret) return true;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  return !!token && token === cronSecret;
}

function previousMonthPeriod(now: Date) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const prevM = m - 1;
  if (prevM >= 1) return `${y}-${String(prevM).padStart(2, "0")}`;
  return `${y - 1}-12`;
}

function parsePeriod(periodRaw: string) {
  const p = periodRaw.trim();
  if (!/^\d{4}-\d{2}$/.test(p)) return null;
  const [yy, mm] = p.split("-");
  const y = Number(yy);
  const m = Number(mm);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  return { period: p, year: y, month: m };
}

async function readBody(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return (await req.json()) as unknown;
    } catch {
      return null;
    }
  }
  try {
    const form = await req.formData();
    const obj: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) obj[k] = typeof v === "string" ? v : String(v);
    return obj;
  } catch {
    return null;
  }
}

function truthy(v: unknown) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "y" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n" || s === "off") return false;
  return null;
}

function appUrlFromEnv() {
  const raw = (process.env.APP_URL ?? "").trim();
  return (raw || "http://localhost:3000").replace(/\/$/, "");
}

async function distributeReportSnapshot(args: {
  reportId: string;
  type: ReportType;
  scope: ReportScope;
  period: string;
  city?: string | null;
  state?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  distribute: boolean;
}) {
  if (!args.distribute) return { webhooks: 0, emails: 0 };

  const appUrl = appUrlFromEnv();
  const jsonUrl = `${appUrl}/api/reports/${encodeURIComponent(args.reportId)}`;
  const xlsxSummaryUrl = `${appUrl}/api/reports/${encodeURIComponent(args.reportId)}/export?format=xlsx&table=summary`;
  const xlsxCategoriesUrl = `${appUrl}/api/reports/${encodeURIComponent(args.reportId)}/export?format=xlsx&table=categories`;
  const csvSummaryUrl = `${appUrl}/api/reports/${encodeURIComponent(args.reportId)}/export?format=csv&table=summary`;
  const csvCategoriesUrl = `${appUrl}/api/reports/${encodeURIComponent(args.reportId)}/export?format=csv&table=categories`;

  const payload = {
    reportId: args.reportId,
    type: args.type,
    scope: args.scope,
    period: args.period,
    city: args.city ?? null,
    state: args.state ?? null,
    companyId: args.companyId ?? null,
    downloads: {
      json: jsonUrl,
      xlsx: { summary: xlsxSummaryUrl, categories: xlsxCategoriesUrl },
      csv: { summary: csvSummaryUrl, categories: csvCategoriesUrl },
    },
  };

  const subject = (() => {
    if (args.type === ReportType.CITY_MONTHLY) return `Relatório mensal SANE+ — ${args.city ?? ""}/${args.state ?? ""} — ${args.period}`.trim();
    if (args.type === ReportType.COMPANY_MONTHLY) {
      const name = args.companyName?.trim() || args.companyId || "";
      return `Relatório mensal SANE+ — ${name} — ${args.period}`.trim();
    }
    if (args.type === ReportType.REGIONAL_QUARTERLY) return `Relatório trimestral SANE+ — ${args.state ?? ""} — ${args.period}`.trim();
    if (args.type === ReportType.NATIONAL_ANNUAL) return `Relatório anual SANE+ — ${args.period}`.trim();
    return `Relatório SANE+ — ${args.period}`.trim();
  })();

  const body = [
    "Olá,",
    "",
    `Um relatório institucional do SANE+ foi gerado (${args.type}).`,
    "",
    `Período: ${args.period}`,
    args.city && args.state ? `Cidade: ${args.city}/${args.state}` : null,
    args.state && !args.city ? `UF: ${args.state}` : null,
    args.companyId ? `Empresa: ${args.companyName?.trim() || args.companyId}` : null,
    "",
    "Downloads:",
    `- JSON: ${jsonUrl}`,
    `- XLSX (Resumo): ${xlsxSummaryUrl}`,
    `- XLSX (Categorias): ${xlsxCategoriesUrl}`,
    `- CSV (Resumo): ${csvSummaryUrl}`,
    `- CSV (Categorias): ${csvCategoriesUrl}`,
    "",
    "Obs.: relatórios não públicos exigem autenticação e respeitam o escopo (empresa/cidade/equipe).",
  ]
    .filter(Boolean)
    .join("\n");

  let webhooks = 0;
  let emails = 0;

  if (args.type === ReportType.COMPANY_MONTHLY) {
    if (args.companyId) {
      const w = await publishIntegrationEvent({
        prisma,
        companyId: args.companyId,
        city: args.city ?? null,
        state: args.state ?? null,
        eventType: "report.generated",
        payload,
      });
      const e = await publishOfficialEmail({
        prisma,
        companyId: args.companyId,
        city: args.city ?? null,
        state: args.state ?? null,
        subject,
        body,
        meta: { reportId: args.reportId, type: args.type, scope: args.scope, period: args.period },
      });
      webhooks += w.queued;
      emails += e.queued;
    }
  } else if (args.type === ReportType.CITY_MONTHLY || args.type === ReportType.INSTITUTIONAL_MONTHLY) {
    const w = await publishIntegrationEventToCityScope({
      prisma,
      city: args.city ?? null,
      state: args.state ?? null,
      eventType: "report.generated",
      payload,
    });
    const e = await publishOfficialEmailToCityScope({
      prisma,
      city: args.city ?? null,
      state: args.state ?? null,
      subject,
      body,
      meta: { reportId: args.reportId, type: args.type, scope: args.scope, period: args.period },
    });
    webhooks += w.queued;
    emails += e.queued;
  } else if (args.type === ReportType.REGIONAL_QUARTERLY || args.type === ReportType.INSTITUTIONAL_QUARTERLY) {
    const w = await publishIntegrationEventToCityScope({
      prisma,
      state: args.state ?? null,
      eventType: "report.generated",
      payload,
    });
    const e = await publishOfficialEmailToCityScope({
      prisma,
      state: args.state ?? null,
      subject,
      body,
      meta: { reportId: args.reportId, type: args.type, scope: args.scope, period: args.period },
    });
    webhooks += w.queued;
    emails += e.queued;
  } else if (args.type === ReportType.NATIONAL_ANNUAL || args.type === ReportType.INSTITUTIONAL_ANNUAL) {
    const w = await publishIntegrationEventToCityScope({ prisma, eventType: "report.generated", payload });
    const e = await publishOfficialEmailToCityScope({
      prisma,
      subject,
      body,
      meta: { reportId: args.reportId, type: args.type, scope: args.scope, period: args.period },
    });
    webhooks += w.queued;
    emails += e.queued;
  }

  return { webhooks, emails };
}

async function handle(req: NextRequest) {
  const isCron = isCronRequest(req);

  const user = isCron ? null : await requireUser();
  if (!isCron && (!user || !isStaff(user.role))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ip = getClientIp(req.headers);
  const rl = rateLimit({
    key: `admin:jobs:monthly:${user?.id ?? "cron"}:${ip}`,
    limit: isCron ? 20 : 10,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const url = new URL(req.url);
  const body = req.method === "POST" ? await readBody(req) : null;
  const periodRaw =
    typeof body === "object" && body
      ? String((body as Record<string, unknown>)["period"] ?? "")
      : (url.searchParams.get("period") ?? "");
  const publishRaw = typeof body === "object" && body ? (body as Record<string, unknown>)["publish"] : null;
  const publishQuery = url.searchParams.get("publish");
  const publishFinal = publishRaw == null ? publishQuery : publishRaw;
  const publish =
    publishFinal == null ? true : String(publishFinal) === "1" || String(publishFinal).toLowerCase() === "true";
  const distributeRaw = typeof body === "object" && body ? (body as Record<string, unknown>)["distribute"] : null;
  const distributeFinal = distributeRaw == null ? url.searchParams.get("distribute") : distributeRaw;
  const distribute = truthy(distributeFinal) ?? isCron;
  const retriesBody = typeof body === "object" && body ? (body as Record<string, unknown>)["retries"] : null;
  const retries = clampInt(retriesBody ?? url.searchParams.get("retries"), 0, 5, 1);

  const fallback = parsePeriod(previousMonthPeriod(new Date()));
  const parsed = periodRaw.trim() ? parsePeriod(periodRaw) : fallback;
  if (!parsed) return NextResponse.json({ error: "invalid_period" }, { status: 400 });

  const scopeCity = publish ? ReportScope.PUBLIC : ReportScope.CITY;
  const scopeRegion = publish ? ReportScope.PUBLIC : ReportScope.REGION;
  const scopeNational = publish ? ReportScope.PUBLIC : ReportScope.NATIONAL;

  const startedAt = new Date();
  const run = await prisma.jobRun.create({
    data: {
      name: "monthly",
      status: JobRunStatus.RUNNING,
      period: parsed.period,
      meta: { isCron, publish, retries },
      userId: user?.id ?? null,
      ip,
      startedAt,
    },
    select: { id: true },
  });

  const retryErrors: string[] = [];
  const retryDelaysMs: number[] = [];

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const companies = await prisma.company.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, city: true, state: true },
      });

      let companyUpserts = 0;
      for (const c of companies) {
        const metric = await computeCompanyMetricForPeriod(prisma, { companyId: c.id, period: parsed.period });
        if (!metric) continue;
        const prev = await prisma.companyMetric.findUnique({
          where: { companyId_period: { companyId: c.id, period: parsed.period } },
          select: {
            complaintsReceived: true,
            complaintsReplied: true,
            complaintsResolved: true,
            avgResponseMs: true,
            averageScore: true,
            calculatedAt: true,
          },
        });
        const previousHash = prev
          ? sha256OfJson({
              companyId: c.id,
              period: parsed.period,
              complaintsReceived: prev.complaintsReceived,
              complaintsReplied: prev.complaintsReplied,
              complaintsResolved: prev.complaintsResolved,
              avgResponseMs: prev.avgResponseMs,
              averageScore: prev.averageScore,
              calculatedAt: prev.calculatedAt.toISOString(),
            })
          : null;
        const output = { companyId: c.id, ...metric };
        const outputHash = sha256OfJson({
          ...output,
          calculatedAt: output.calculatedAt instanceof Date ? output.calculatedAt.toISOString() : output.calculatedAt,
        });
        await prisma.companyMetric.upsert({
          where: { companyId_period: { companyId: c.id, period: parsed.period } },
          create: { companyId: c.id, ...metric },
          update: { ...metric },
        });
        await safeCreatePipelineEvent({
          data: {
            runId: run.id,
            dataset: PipelineDataset.COMPANY_METRIC,
            action: "UPSERT",
            period: parsed.period,
            companyId: c.id,
            inputMeta: { job: "monthly" },
            output,
            previousHash: previousHash ?? undefined,
            outputHash,
          },
          select: { id: true },
        });
        await createPipelineSnapshotIfChanged(prisma, {
          runId: run.id,
          dataset: PipelineDataset.COMPANY_METRIC,
          period: parsed.period,
          companyId: c.id,
          previousHash,
          outputHash,
          payload: output,
        });
        companyUpserts += 1;
      }

      let cityUpserts = 0;
      const cityKeys = new Set<string>();
      const states = new Set<string>();
      for (const c of companies) {
        const city = c.city?.trim();
        const state = c.state?.trim();
        if (state) states.add(state);
        if (!city || !state) continue;
        cityKeys.add(`${city}||${state}`);
      }
      for (const k of cityKeys) {
        const [city, state] = k.split("||");
        if (!city || !state) continue;
        const metric = await computeCityMetricForPeriod(prisma, { city, state, period: parsed.period });
        if (!metric) continue;
        const prev = await prisma.cityMetric.findUnique({
          where: { city_state_period: { city, state, period: parsed.period } },
          select: {
            complaintsTotal: true,
            complaintsOpen: true,
            complaintsReplied: true,
            complaintsResolved: true,
            recurringCount: true,
            avgResponseMs: true,
            avgResolutionMs: true,
            solutionRate: true,
            byCategory: true,
            byNeighborhood: true,
            calculatedAt: true,
          },
        });
        const previousHash = prev
          ? sha256OfJson({
              city,
              state,
              period: parsed.period,
              complaintsTotal: prev.complaintsTotal,
              complaintsOpen: prev.complaintsOpen,
              complaintsReplied: prev.complaintsReplied,
              complaintsResolved: prev.complaintsResolved,
              recurringCount: prev.recurringCount,
              avgResponseMs: prev.avgResponseMs,
              avgResolutionMs: prev.avgResolutionMs,
              solutionRate: prev.solutionRate,
              byCategory: prev.byCategory,
              byNeighborhood: prev.byNeighborhood,
              calculatedAt: prev.calculatedAt.toISOString(),
            })
          : null;
        const output = metric;
        const outputHash = sha256OfJson({
          ...output,
          calculatedAt: output.calculatedAt instanceof Date ? output.calculatedAt.toISOString() : output.calculatedAt,
        });
        await prisma.cityMetric.upsert({
          where: { city_state_period: { city, state, period: parsed.period } },
          create: metric,
          update: metric,
        });
        await safeCreatePipelineEvent({
          data: {
            runId: run.id,
            dataset: PipelineDataset.CITY_METRIC,
            action: "UPSERT",
            period: parsed.period,
            city,
            state,
            inputMeta: { job: "monthly" },
            output,
            previousHash: previousHash ?? undefined,
            outputHash,
          },
          select: { id: true },
        });
        await createPipelineSnapshotIfChanged(prisma, {
          runId: run.id,
          dataset: PipelineDataset.CITY_METRIC,
          period: parsed.period,
          city,
          state,
          previousHash,
          outputHash,
          payload: output,
        });
        cityUpserts += 1;
      }

      let cityMonthlyCreated = 0;
      let companyMonthlyCreated = 0;
      let institutionalMonthlyCreated = 0;
      let distributionQueuedWebhooks = 0;
      let distributionQueuedEmails = 0;
      for (const k of cityKeys) {
        const [city, state] = k.split("||");
        if (!city || !state) continue;
        const exists = await prisma.reportSnapshot.findFirst({
          where: { type: ReportType.CITY_MONTHLY, scope: scopeCity, period: parsed.period, city, state },
          select: { id: true },
        });
        if (exists) continue;
        const report = await buildReport(prisma, { type: ReportType.CITY_MONTHLY, city, state, period: parsed.period });
        if (!report) continue;
        const created = await prisma.reportSnapshot.create({
          data: { type: ReportType.CITY_MONTHLY, scope: scopeCity, period: report.period, payload: report.payload, city, state },
          select: { id: true },
        });
        const dist = await distributeReportSnapshot({
          reportId: created.id,
          type: ReportType.CITY_MONTHLY,
          scope: scopeCity,
          period: report.period,
          city,
          state,
          distribute,
        });
        distributionQueuedWebhooks += dist.webhooks;
        distributionQueuedEmails += dist.emails;
        try {
          await applyAutomationRules(prisma, {
            trigger: AutomationTrigger.REPORT_GENERATED,
            actor: user ? { id: user.id, role: user.role } : null,
            context: {
              reportId: created.id,
              type: ReportType.CITY_MONTHLY,
              scope: scopeCity,
              period: report.period,
              city,
              state,
            },
          });
        } catch (err) {
          void err;
        }
        await safeCreatePipelineEvent({
          data: {
            runId: run.id,
            dataset: PipelineDataset.REPORT_SNAPSHOT,
            action: "CREATE",
            period: report.period,
            city,
            state,
            inputMeta: { job: "monthly", type: ReportType.CITY_MONTHLY, scope: scopeCity, reportId: created.id },
            output: report.payload,
            outputHash: sha256OfJson(report.payload),
          },
          select: { id: true },
        });
        cityMonthlyCreated += 1;
      }

      for (const k of cityKeys) {
        const [city, state] = k.split("||");
        if (!city || !state) continue;
        const existsInst = await prisma.reportSnapshot.findFirst({
          where: { type: ReportType.INSTITUTIONAL_MONTHLY, scope: scopeCity, period: parsed.period, city, state },
          select: { id: true },
        });
        if (existsInst) continue;
        const reportInst = await buildReport(prisma, { type: ReportType.INSTITUTIONAL_MONTHLY, city, state, period: parsed.period });
        if (!reportInst) continue;
        const createdInst = await prisma.reportSnapshot.create({
          data: { type: ReportType.INSTITUTIONAL_MONTHLY, scope: scopeCity, period: reportInst.period, payload: reportInst.payload, city, state },
          select: { id: true },
        });
        const distInst = await distributeReportSnapshot({
          reportId: createdInst.id,
          type: ReportType.INSTITUTIONAL_MONTHLY,
          scope: scopeCity,
          period: reportInst.period,
          city,
          state,
          distribute,
        });
        distributionQueuedWebhooks += distInst.webhooks;
        distributionQueuedEmails += distInst.emails;
        try {
          await applyAutomationRules(prisma, {
            trigger: AutomationTrigger.REPORT_GENERATED,
            actor: user ? { id: user.id, role: user.role } : null,
            context: {
              reportId: createdInst.id,
              type: ReportType.INSTITUTIONAL_MONTHLY,
              scope: scopeCity,
              period: reportInst.period,
              city,
              state,
            },
          });
        } catch (err) {
          void err;
        }
        await safeCreatePipelineEvent({
          data: {
            runId: run.id,
            dataset: PipelineDataset.REPORT_SNAPSHOT,
            action: "CREATE",
            period: reportInst.period,
            city,
            state,
            inputMeta: { job: "monthly", type: ReportType.INSTITUTIONAL_MONTHLY, scope: scopeCity, reportId: createdInst.id },
            output: reportInst.payload,
            outputHash: sha256OfJson(reportInst.payload),
          },
          select: { id: true },
        });
        institutionalMonthlyCreated += 1;
      }
      const companyTargetsRaw = await prisma.integration.findMany({
        where: {
          status: "ACTIVE",
          scope: "COMPANY",
          companyId: { not: null },
          kind: { in: ["WEBHOOK", "OFFICIAL_EMAIL"] },
        },
        select: { companyId: true },
        take: 5_000,
      });
      const companyTargets = new Set<string>();
      for (const r of companyTargetsRaw) {
        if (r.companyId) companyTargets.add(r.companyId);
      }

      for (const companyId of companyTargets) {
        const exists = await prisma.reportSnapshot.findFirst({
          where: { type: ReportType.COMPANY_MONTHLY, scope: ReportScope.COMPANY, period: parsed.period, companyId },
          select: { id: true },
        });
        if (exists) continue;
        const report = await buildReport(prisma, { type: ReportType.COMPANY_MONTHLY, companyId, period: parsed.period });
        if (!report) continue;
        const company = await prisma.company.findUnique({
          where: { id: companyId },
          select: { id: true, name: true, city: true, state: true },
        });
        const created = await prisma.reportSnapshot.create({
          data: { type: ReportType.COMPANY_MONTHLY, scope: ReportScope.COMPANY, period: report.period, payload: report.payload, companyId },
          select: { id: true },
        });
        const dist = await distributeReportSnapshot({
          reportId: created.id,
          type: ReportType.COMPANY_MONTHLY,
          scope: ReportScope.COMPANY,
          period: report.period,
          companyId,
          companyName: company?.name ?? null,
          city: company?.city ?? null,
          state: company?.state ?? null,
          distribute,
        });
        distributionQueuedWebhooks += dist.webhooks;
        distributionQueuedEmails += dist.emails;
        try {
          await applyAutomationRules(prisma, {
            trigger: AutomationTrigger.REPORT_GENERATED,
            actor: user ? { id: user.id, role: user.role } : null,
            context: {
              reportId: created.id,
              type: ReportType.COMPANY_MONTHLY,
              scope: ReportScope.COMPANY,
              period: report.period,
              companyId,
            },
          });
        } catch (err) {
          void err;
        }
        await safeCreatePipelineEvent({
          data: {
            runId: run.id,
            dataset: PipelineDataset.REPORT_SNAPSHOT,
            action: "CREATE",
            period: report.period,
            companyId,
            inputMeta: { job: "monthly", type: ReportType.COMPANY_MONTHLY, scope: ReportScope.COMPANY, reportId: created.id },
            output: report.payload,
            outputHash: sha256OfJson(report.payload),
          },
          select: { id: true },
        });
        companyMonthlyCreated += 1;
      }

      let regionalQuarterlyCreated = 0;
      let nationalAnnualCreated = 0;
      let institutionalAnnualCreated = 0;
      let institutionalQuarterlyCreated = 0;

      const isQuarterEnd = parsed.month === 3 || parsed.month === 6 || parsed.month === 9 || parsed.month === 12;
      if (isQuarterEnd) {
        const quarter = Math.ceil(parsed.month / 3);
        const quarterPeriod = `${parsed.year}-Q${quarter}`;
        for (const state of states) {
          const exists = await prisma.reportSnapshot.findFirst({
            where: { type: ReportType.REGIONAL_QUARTERLY, scope: scopeRegion, period: quarterPeriod, state },
            select: { id: true },
          });
          if (exists) continue;
          const report = await buildReport(prisma, { type: ReportType.REGIONAL_QUARTERLY, state, year: parsed.year, quarter });
          if (!report) continue;
          const created = await prisma.reportSnapshot.create({
            data: { type: ReportType.REGIONAL_QUARTERLY, scope: scopeRegion, period: report.period, payload: report.payload, state },
            select: { id: true },
          });
          const dist = await distributeReportSnapshot({
            reportId: created.id,
            type: ReportType.REGIONAL_QUARTERLY,
            scope: scopeRegion,
            period: report.period,
            state,
            distribute,
          });
          distributionQueuedWebhooks += dist.webhooks;
          distributionQueuedEmails += dist.emails;
          try {
            await applyAutomationRules(prisma, {
              trigger: AutomationTrigger.REPORT_GENERATED,
              actor: user ? { id: user.id, role: user.role } : null,
              context: {
                reportId: created.id,
                type: ReportType.REGIONAL_QUARTERLY,
                scope: scopeRegion,
                period: report.period,
                state,
              },
            });
          } catch (err) {
            void err;
          }
          await safeCreatePipelineEvent({
            data: {
              runId: run.id,
              dataset: PipelineDataset.REPORT_SNAPSHOT,
              action: "CREATE",
              period: report.period,
              state,
              inputMeta: { job: "monthly", type: ReportType.REGIONAL_QUARTERLY, scope: scopeRegion, reportId: created.id },
              output: report.payload,
              outputHash: sha256OfJson(report.payload),
            },
            select: { id: true },
          });
          regionalQuarterlyCreated += 1;
        }

        for (const state of states) {
          const existsInst = await prisma.reportSnapshot.findFirst({
            where: { type: ReportType.INSTITUTIONAL_QUARTERLY, scope: scopeRegion, period: quarterPeriod, state },
            select: { id: true },
          });
          if (existsInst) continue;
          const reportInst = await buildReport(prisma, { type: ReportType.INSTITUTIONAL_QUARTERLY, state, year: parsed.year, quarter });
          if (!reportInst) continue;
          const createdInst = await prisma.reportSnapshot.create({
            data: { type: ReportType.INSTITUTIONAL_QUARTERLY, scope: scopeRegion, period: reportInst.period, payload: reportInst.payload, state },
            select: { id: true },
          });
          const distInst = await distributeReportSnapshot({
            reportId: createdInst.id,
            type: ReportType.INSTITUTIONAL_QUARTERLY,
            scope: scopeRegion,
            period: reportInst.period,
            state,
            distribute,
          });
          distributionQueuedWebhooks += distInst.webhooks;
          distributionQueuedEmails += distInst.emails;
          try {
            await applyAutomationRules(prisma, {
              trigger: AutomationTrigger.REPORT_GENERATED,
              actor: user ? { id: user.id, role: user.role } : null,
              context: {
                reportId: createdInst.id,
                type: ReportType.INSTITUTIONAL_QUARTERLY,
                scope: scopeRegion,
                period: reportInst.period,
                state,
              },
            });
          } catch (err) {
            void err;
          }
          await safeCreatePipelineEvent({
            data: {
              runId: run.id,
              dataset: PipelineDataset.REPORT_SNAPSHOT,
              action: "CREATE",
              period: reportInst.period,
              state,
              inputMeta: { job: "monthly", type: ReportType.INSTITUTIONAL_QUARTERLY, scope: scopeRegion, reportId: createdInst.id },
              output: reportInst.payload,
              outputHash: sha256OfJson(reportInst.payload),
            },
            select: { id: true },
          });
          institutionalQuarterlyCreated += 1;
        }
      }

      if (parsed.month === 12) {
        const year = parsed.year;
        const yearPeriod = String(year);
        const exists = await prisma.reportSnapshot.findFirst({
          where: { type: ReportType.NATIONAL_ANNUAL, scope: scopeNational, period: yearPeriod },
          select: { id: true },
        });
        if (!exists) {
          const report = await buildReport(prisma, { type: ReportType.NATIONAL_ANNUAL, year });
          if (report) {
            const created = await prisma.reportSnapshot.create({
              data: { type: ReportType.NATIONAL_ANNUAL, scope: scopeNational, period: report.period, payload: report.payload },
              select: { id: true },
            });
            const dist = await distributeReportSnapshot({
              reportId: created.id,
              type: ReportType.NATIONAL_ANNUAL,
              scope: scopeNational,
              period: report.period,
              distribute,
            });
            distributionQueuedWebhooks += dist.webhooks;
            distributionQueuedEmails += dist.emails;
            try {
              await applyAutomationRules(prisma, {
                trigger: AutomationTrigger.REPORT_GENERATED,
                actor: user ? { id: user.id, role: user.role } : null,
                context: {
                  reportId: created.id,
                  type: ReportType.NATIONAL_ANNUAL,
                  scope: scopeNational,
                  period: report.period,
                },
              });
            } catch (err) {
              void err;
            }
            await safeCreatePipelineEvent({
              data: {
                runId: run.id,
                dataset: PipelineDataset.REPORT_SNAPSHOT,
                action: "CREATE",
                period: report.period,
                inputMeta: { job: "monthly", type: ReportType.NATIONAL_ANNUAL, scope: scopeNational, reportId: created.id },
                output: report.payload,
                outputHash: sha256OfJson(report.payload),
              },
              select: { id: true },
            });
            nationalAnnualCreated = 1;
          }
        }

        const existsInst = await prisma.reportSnapshot.findFirst({
          where: { type: ReportType.INSTITUTIONAL_ANNUAL, scope: scopeNational, period: yearPeriod },
          select: { id: true },
        });
        if (!existsInst) {
          const reportInst = await buildReport(prisma, { type: ReportType.INSTITUTIONAL_ANNUAL, year });
          if (reportInst) {
            const createdInst = await prisma.reportSnapshot.create({
              data: { type: ReportType.INSTITUTIONAL_ANNUAL, scope: scopeNational, period: reportInst.period, payload: reportInst.payload },
              select: { id: true },
            });
            const distInst = await distributeReportSnapshot({
              reportId: createdInst.id,
              type: ReportType.INSTITUTIONAL_ANNUAL,
              scope: scopeNational,
              period: reportInst.period,
              distribute,
            });
            distributionQueuedWebhooks += distInst.webhooks;
            distributionQueuedEmails += distInst.emails;
            try {
              await applyAutomationRules(prisma, {
                trigger: AutomationTrigger.REPORT_GENERATED,
                actor: user ? { id: user.id, role: user.role } : null,
                context: {
                  reportId: createdInst.id,
                  type: ReportType.INSTITUTIONAL_ANNUAL,
                  scope: scopeNational,
                  period: reportInst.period,
                },
              });
            } catch (err) {
              void err;
            }
            await safeCreatePipelineEvent({
              data: {
                runId: run.id,
                dataset: PipelineDataset.REPORT_SNAPSHOT,
                action: "CREATE",
                period: reportInst.period,
                inputMeta: { job: "monthly", type: ReportType.INSTITUTIONAL_ANNUAL, scope: scopeNational, reportId: createdInst.id },
                output: reportInst.payload,
                outputHash: sha256OfJson(reportInst.payload),
              },
              select: { id: true },
            });
            institutionalAnnualCreated = 1;
          }
        }
      }

      const finishedAt = new Date();
      await prunePipelineSnapshotsByAge(prisma);
      await prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: JobRunStatus.SUCCESS,
          finishedAt,
          durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
          meta: {
            isCron,
            publish,
            retries,
            attempts: attempt,
            retriesUsed: attempt - 1,
            retryDelaysMs,
            retryErrors,
            companyUpserts,
            cityUpserts,
            cityMonthlyCreated,
            companyMonthlyCreated,
            regionalQuarterlyCreated,
            nationalAnnualCreated,
            institutionalMonthlyCreated,
            institutionalQuarterlyCreated,
            institutionalAnnualCreated,
            distributionQueuedWebhooks,
            distributionQueuedEmails,
          },
        },
        select: { id: true },
      });

      return NextResponse.json({
        ok: true,
        period: parsed.period,
        publish,
        companyUpserts,
        cityUpserts,
        cityMonthlyCreated,
        companyMonthlyCreated,
        regionalQuarterlyCreated,
        nationalAnnualCreated,
        institutionalMonthlyCreated,
        institutionalQuarterlyCreated,
        institutionalAnnualCreated,
        distributionQueuedWebhooks,
        distributionQueuedEmails,
        runId: run.id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      retryErrors.push(message.slice(0, 500));
      const retriesUsed = attempt - 1;
      const retriesLeft = retries - retriesUsed;

      if (retriesLeft <= 0) {
        const finishedAt = new Date();
        await prisma.jobRun.update({
          where: { id: run.id },
          data: {
            status: JobRunStatus.FAILED,
            finishedAt,
            durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
            error: message.slice(0, 2000),
            meta: {
              isCron,
              publish,
              retries,
              attempts: attempt,
              retriesUsed,
              retryDelaysMs,
              retryErrors,
            },
          },
          select: { id: true },
        });

        const staff = await prisma.user.findMany({
          where: { role: { in: [UserRole.ADMIN, UserRole.MODERATOR, UserRole.LEGAL] }, notifyInApp: true },
          select: { id: true },
        });
        if (staff.length) {
          await prisma.notification.createMany({
            data: staff.map((u) => ({
              userId: u.id,
              type: NotificationType.SYSTEM,
              title: "Falha no job mensal",
              message: `O job mensal falhou (runId ${run.id}) após ${retriesUsed} retry(s). Motivo: ${message}`.slice(0, 900),
              actionUrl: "/reports",
            })),
          });
        }

        return NextResponse.json({ error: "job_failed", runId: run.id }, { status: 500 });
      }

      const delayMs = computeBackoffMs(retriesUsed);
      retryDelaysMs.push(delayMs);
      await prisma.jobRun.update({
        where: { id: run.id },
        data: {
          meta: {
            isCron,
            publish,
            retries,
            attempts: attempt,
            retriesUsed,
            retryDelaysMs,
            retryErrors,
            lastError: message.slice(0, 900),
            nextRetryInMs: delayMs,
          },
        },
        select: { id: true },
      });
      await sleep(delayMs);
    }
  }

  return NextResponse.json({ error: "job_failed", runId: run.id }, { status: 500 });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
