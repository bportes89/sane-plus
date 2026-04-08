import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { getOpenDataDataset, getOpenDataDatasetIds } from "@/lib/openData";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `open-data:dataset:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { id } = await params;
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const ids = new Set(getOpenDataDatasetIds());
  if (!ids.has(id as never)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const dataset = getOpenDataDataset(baseUrl, id as never);
  return NextResponse.json(
    {
      ...dataset,
      generatedAt: new Date().toISOString(),
      versions: [
        {
          version: dataset.version,
          schemaVersion: dataset.schemaVersion,
          links: dataset.links,
        },
      ],
    },
    { headers: { "cache-control": "no-store" } },
  );
}

