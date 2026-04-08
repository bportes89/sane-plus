import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { listOpenDataDatasets } from "@/lib/openData";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `open-data:datasets:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, Math.min(100_000, Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0));

  const baseUrl = `${url.protocol}//${url.host}`;
  const all = listOpenDataDatasets(baseUrl);
  const items = all.slice(offset, offset + limit);

  return NextResponse.json(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      total: all.length,
      limit,
      offset,
      items,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

