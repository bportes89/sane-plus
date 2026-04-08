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

export async function GET(req: NextRequest) {
  const isCron = isCronRequest(req);
  const user = isCron ? null : await requireUser();
  if (!isCron && (!user || !isStaff(user.role))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ip = getClientIp(req.headers);
  const rl = rateLimit({
    key: `admin:pipeline:lineage:${user?.id ?? "cron"}:${ip}`,
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
  const action = (url.searchParams.get("action") ?? "").trim() || null;
  const runId = (url.searchParams.get("runId") ?? "").trim() || null;
  const companyId = (url.searchParams.get("companyId") ?? "").trim() || null;
  const city = (url.searchParams.get("city") ?? "").trim() || null;
  const state = (url.searchParams.get("state") ?? "").trim() || null;
  const limitRaw = Number(url.searchParams.get("limit") ?? "");
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 50));

  const where: Record<string, unknown> = {
    ...(dataset ? { dataset } : {}),
    ...(period ? { period } : {}),
    ...(action ? { action } : {}),
    ...(runId ? { runId } : {}),
    ...(companyId ? { companyId } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
  };

  const items = await prisma.pipelineEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      runId: true,
      dataset: true,
      action: true,
      period: true,
      companyId: true,
      city: true,
      state: true,
      previousHash: true,
      outputHash: true,
      createdAt: true,
      inputMeta: true,
    },
  });

  return NextResponse.json({ ok: true, count: items.length, items });
}

