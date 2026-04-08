import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { PipelineDataset, UserRole } from "@/generated/prisma/client";

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

function toDataset(raw: string | null) {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v) return null;
  if (v in PipelineDataset) return v as PipelineDataset;
  return null;
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

export async function GET(req: NextRequest) {
  const isCron = isCronRequest(req);
  const user = isCron ? null : await requireUser();
  if (!isCron && (!user || !isStaff(user.role))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ip = getClientIp(req.headers);
  const rl = rateLimit({
    key: `admin:pipeline:snapshots:${user?.id ?? "cron"}:${ip}`,
    limit: isCron ? 120 : 60,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const url = new URL(req.url);
  const dataset = toDataset(url.searchParams.get("dataset"));
  const period = (url.searchParams.get("period") ?? "").trim() || null;
  const runId = (url.searchParams.get("runId") ?? "").trim() || null;
  const companyId = (url.searchParams.get("companyId") ?? "").trim() || null;
  const city = (url.searchParams.get("city") ?? "").trim() || null;
  const state = (url.searchParams.get("state") ?? "").trim() || null;
  const includePayload = (url.searchParams.get("includePayload") ?? "") === "1";
  const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);
  const offset = clampInt(url.searchParams.get("offset"), 0, 50_000, 0);

  const where: Record<string, unknown> = {
    ...(dataset ? { dataset } : {}),
    ...(period ? { period } : {}),
    ...(runId ? { runId } : {}),
    ...(companyId ? { companyId } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
  };

  const items = await prisma.pipelineSnapshot.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { version: "desc" }],
    take: limit,
    skip: offset,
    select: {
      id: true,
      runId: true,
      dataset: true,
      period: true,
      companyId: true,
      city: true,
      state: true,
      version: true,
      previousHash: true,
      outputHash: true,
      changeSummary: true,
      createdAt: true,
      ...(includePayload ? { payload: true } : {}),
    },
  });

  return NextResponse.json({ ok: true, count: items.length, items, nextOffset: items.length ? offset + items.length : null });
}

