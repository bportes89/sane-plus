import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { JobRunStatus, NotificationType, PipelineDataset, UserRole } from "@/generated/prisma/client";
import {
  computeCityMetricForPeriod,
  computeCompanyMetricForPeriod,
  periodFromDate,
  scanDataAlerts,
} from "@/lib/analytics";
import { sha256OfJson } from "@/lib/pipeline";
import { createPipelineSnapshotIfChanged, prunePipelineSnapshotsByAge } from "@/lib/pipeline";
import { processComplaintSlas } from "@/lib/complaintSlas";

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
  const base = 250;
  const max = 2_000;
  const raw = Math.min(max, base * 2 ** Math.max(0, retryIndex));
  const jitter = Math.floor(Math.random() * 120);
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

async function handle(req: NextRequest) {
  const isCron = isCronRequest(req);

  const user = isCron ? null : await requireUser();
  if (!isCron && (!user || !isStaff(user.role))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ip = getClientIp(req.headers);
  const rl = rateLimit({
    key: `admin:jobs:daily:${user?.id ?? "cron"}:${ip}`,
    limit: isCron ? 60 : 15,
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

  const periodBody = typeof body === "object" && body ? String((body as Record<string, unknown>)["period"] ?? "") : "";
  const modeBody = typeof body === "object" && body ? String((body as Record<string, unknown>)["mode"] ?? "all") : "all";
  const windowHoursRaw = typeof body === "object" && body ? (body as Record<string, unknown>)["windowHours"] : null;

  const period = periodBody.trim() || (url.searchParams.get("period") ?? "").trim();
  const mode = (modeBody || url.searchParams.get("mode") || "all").trim();
  const windowHoursQuery = Number(url.searchParams.get("windowHours") ?? "");
  const windowHoursValue =
    typeof windowHoursRaw === "number"
      ? windowHoursRaw
      : windowHoursRaw == null
        ? windowHoursQuery
        : Number(windowHoursRaw);
  const windowHours = Math.max(6, Math.min(168, Number.isFinite(windowHoursValue) && windowHoursValue > 0 ? windowHoursValue : 48));
  const retriesBody = typeof body === "object" && body ? (body as Record<string, unknown>)["retries"] : null;
  const retries = clampInt(retriesBody ?? url.searchParams.get("retries"), 0, 5, 2);

  const finalPeriod = period || periodFromDate(new Date());
  const startedAt = new Date();

  const run = await prisma.jobRun.create({
    data: {
      name: "daily",
      status: JobRunStatus.RUNNING,
      period: finalPeriod,
      meta: { isCron, mode, windowHours, retries },
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
    if (mode === "all" || mode === "company") {
      for (const c of companies) {
        const metric = await computeCompanyMetricForPeriod(prisma, { companyId: c.id, period: finalPeriod });
        if (!metric) continue;
        const prev = await prisma.companyMetric.findUnique({
          where: { companyId_period: { companyId: c.id, period: finalPeriod } },
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
              period: finalPeriod,
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
          where: { companyId_period: { companyId: c.id, period: finalPeriod } },
          create: { companyId: c.id, ...metric },
          update: { ...metric },
        });
        await safeCreatePipelineEvent({
          data: {
            runId: run.id,
            dataset: PipelineDataset.COMPANY_METRIC,
            action: "UPSERT",
            period: finalPeriod,
            companyId: c.id,
            inputMeta: { job: "daily" },
            output,
            previousHash: previousHash ?? undefined,
            outputHash,
          },
          select: { id: true },
        });
        await createPipelineSnapshotIfChanged(prisma, {
          runId: run.id,
          dataset: PipelineDataset.COMPANY_METRIC,
          period: finalPeriod,
          companyId: c.id,
          previousHash,
          outputHash,
          payload: output,
        });
        companyUpserts += 1;
      }
    }

    let cityUpserts = 0;
    if (mode === "all" || mode === "city") {
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
        const metric = await computeCityMetricForPeriod(prisma, { city, state, period: finalPeriod });
        if (!metric) continue;
        const prev = await prisma.cityMetric.findUnique({
          where: { city_state_period: { city, state, period: finalPeriod } },
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
              period: finalPeriod,
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
          where: { city_state_period: { city, state, period: finalPeriod } },
          create: metric,
          update: metric,
        });
        await safeCreatePipelineEvent({
          data: {
            runId: run.id,
            dataset: PipelineDataset.CITY_METRIC,
            action: "UPSERT",
            period: finalPeriod,
            city,
            state,
            inputMeta: { job: "daily" },
            output,
            previousHash: previousHash ?? undefined,
            outputHash,
          },
          select: { id: true },
        });
        await createPipelineSnapshotIfChanged(prisma, {
          runId: run.id,
          dataset: PipelineDataset.CITY_METRIC,
          period: finalPeriod,
          city,
          state,
          previousHash,
          outputHash,
          payload: output,
        });
        cityUpserts += 1;
      }
    }

    const alerts = await scanDataAlerts(prisma, { windowHours });
    const complaintSlas =
      mode === "all" || mode === "company"
        ? await processComplaintSlas(prisma, {
            actor: user ? { id: user.id, role: user.role } : null,
            hoursCompanyFirstReply: 48,
            hoursUrgentFirstReply: 6,
            limit: 500,
            dryRun: false,
            now: new Date(),
            ip: req.headers.get("x-forwarded-for") ?? null,
            userAgent: req.headers.get("user-agent") ?? null,
          })
        : null;
    await prunePipelineSnapshotsByAge(prisma);
    const finishedAt = new Date();

    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: JobRunStatus.SUCCESS,
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        meta: {
          isCron,
          mode,
          windowHours,
          retries,
          attempts: attempt,
          retriesUsed: attempt - 1,
          retryDelaysMs,
          retryErrors,
          companyUpserts,
          cityUpserts,
          alertsCreated: alerts.created,
          complaintSla: complaintSlas && complaintSlas.ok ? complaintSlas.counts : null,
        },
      },
      select: { id: true },
    });

    return NextResponse.json({
      ok: true,
      period: finalPeriod,
      companyUpserts,
      cityUpserts,
      alertsCreated: alerts.created,
      complaintSla: complaintSlas && complaintSlas.ok ? complaintSlas.counts : null,
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
              mode,
              windowHours,
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
              title: "Falha no job diário",
              message: `O job diário falhou (runId ${run.id}) após ${retriesUsed} retry(s). Motivo: ${message}`.slice(0, 900),
              actionUrl: "/alerts",
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
            mode,
            windowHours,
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
