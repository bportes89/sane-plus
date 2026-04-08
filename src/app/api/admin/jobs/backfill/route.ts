import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { JobRunStatus, PipelineDataset, UserRole } from "@/generated/prisma/client";
import { computeCityMetricForPeriod, computeCompanyMetricForPeriod } from "@/lib/analytics";
import { sha256OfJson } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
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

function parsePeriod(periodRaw: string) {
  const p = periodRaw.trim();
  if (!/^\d{4}-\d{2}$/.test(p)) return null;
  const [yy, mm] = p.split("-");
  const y = Number(yy);
  const m = Number(mm);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  return { period: p, year: y, month: m };
}

function nextMonthPeriod(period: string) {
  const parsed = parsePeriod(period);
  if (!parsed) return null;
  const y = parsed.month === 12 ? parsed.year + 1 : parsed.year;
  const m = parsed.month === 12 ? 1 : parsed.month + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function buildPeriodRange(from: string, to: string) {
  const start = parsePeriod(from);
  const end = parsePeriod(to);
  if (!start || !end) return null;
  const periods: string[] = [];
  let cur = start.period;
  for (let i = 0; i < 240; i += 1) {
    periods.push(cur);
    if (cur === end.period) return periods;
    const nxt = nextMonthPeriod(cur);
    if (!nxt) return null;
    cur = nxt;
  }
  return null;
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
    key: `admin:jobs:backfill:${user?.id ?? "cron"}:${ip}`,
    limit: isCron ? 10 : 5,
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

  const fromRaw =
    typeof body === "object" && body ? String((body as Record<string, unknown>)["from"] ?? "") : "";
  const toRaw = typeof body === "object" && body ? String((body as Record<string, unknown>)["to"] ?? "") : "";
  const modeRaw =
    typeof body === "object" && body ? String((body as Record<string, unknown>)["mode"] ?? "all") : "all";
  const companyIdRaw =
    typeof body === "object" && body ? String((body as Record<string, unknown>)["companyId"] ?? "") : "";
  const cityRaw = typeof body === "object" && body ? String((body as Record<string, unknown>)["city"] ?? "") : "";
  const stateRaw = typeof body === "object" && body ? String((body as Record<string, unknown>)["state"] ?? "") : "";

  const from = (fromRaw.trim() || url.searchParams.get("from") || "").trim();
  const to = (toRaw.trim() || url.searchParams.get("to") || "").trim();
  const mode = (modeRaw.trim() || url.searchParams.get("mode") || "all").trim();
  const companyId = (companyIdRaw.trim() || url.searchParams.get("companyId") || "").trim() || null;
  const city = (cityRaw.trim() || url.searchParams.get("city") || "").trim() || null;
  const state = (stateRaw.trim() || url.searchParams.get("state") || "").trim() || null;

  if (!from || !to) return NextResponse.json({ error: "missing_range" }, { status: 400 });
  const periods = buildPeriodRange(from, to);
  if (!periods) return NextResponse.json({ error: "invalid_range" }, { status: 400 });

  const startedAt = new Date();
  const run = await prisma.jobRun.create({
    data: {
      name: "backfill",
      status: JobRunStatus.RUNNING,
      period: `${from}..${to}`,
      meta: { isCron, from, to, mode, companyId, city, state },
      userId: user?.id ?? null,
      ip,
      startedAt,
    },
    select: { id: true },
  });

  try {
    const now = startedAt;
    const companies = await prisma.company.findMany({
      where: {
        status: "ACTIVE",
        ...(companyId ? { id: companyId } : {}),
        ...(city && state ? { city, state } : {}),
      },
      select: { id: true, city: true, state: true },
    });

    let companyUpserts = 0;
    let cityUpserts = 0;
    const touchedCities = new Set<string>();

    for (const period of periods) {
      if (mode === "all" || mode === "company") {
        for (const c of companies) {
          const metric = await computeCompanyMetricForPeriod(prisma, { companyId: c.id, period, now });
          if (!metric) continue;
          const prev = await prisma.companyMetric.findUnique({
            where: { companyId_period: { companyId: c.id, period } },
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
                period,
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
            where: { companyId_period: { companyId: c.id, period } },
            create: { companyId: c.id, ...metric },
            update: { ...metric },
          });
          await prisma.pipelineEvent.create({
            data: {
              runId: run.id,
              dataset: PipelineDataset.COMPANY_METRIC,
              action: "UPSERT",
              period,
              companyId: c.id,
              inputMeta: { job: "backfill" },
              output,
              previousHash: previousHash ?? undefined,
              outputHash,
            },
            select: { id: true },
          });
          companyUpserts += 1;
        }
      }

      if (mode === "all" || mode === "city") {
        for (const c of companies) {
          const cCity = c.city?.trim();
          const cState = c.state?.trim();
          if (!cCity || !cState) continue;
          if (city && state && (cCity !== city || cState !== state)) continue;
          touchedCities.add(`${cCity}||${cState}`);
        }

        for (const k of touchedCities) {
          const [curCity, curState] = k.split("||");
          if (!curCity || !curState) continue;
          const metric = await computeCityMetricForPeriod(prisma, { city: curCity, state: curState, period, now });
          if (!metric) continue;
          const prev = await prisma.cityMetric.findUnique({
            where: { city_state_period: { city: curCity, state: curState, period } },
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
                city: curCity,
                state: curState,
                period,
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
            where: { city_state_period: { city: curCity, state: curState, period } },
            create: metric,
            update: metric,
          });
          await prisma.pipelineEvent.create({
            data: {
              runId: run.id,
              dataset: PipelineDataset.CITY_METRIC,
              action: "UPSERT",
              period,
              city: curCity,
              state: curState,
              inputMeta: { job: "backfill" },
              output,
              previousHash: previousHash ?? undefined,
              outputHash,
            },
            select: { id: true },
          });
          cityUpserts += 1;
        }
      }
    }

    const finishedAt = new Date();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: JobRunStatus.SUCCESS,
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        meta: {
          isCron,
          from,
          to,
          mode,
          companyId,
          city,
          state,
          periods,
          companyUpserts,
          cityUpserts,
        },
      },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, runId: run.id, from, to, mode, companyUpserts, cityUpserts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: JobRunStatus.FAILED,
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        error: message.slice(0, 2000),
      },
      select: { id: true },
    });
    return NextResponse.json({ error: "job_failed", runId: run.id }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

