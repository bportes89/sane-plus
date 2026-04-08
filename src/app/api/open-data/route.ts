import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { listOpenDataDatasets } from "@/lib/openData";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `open-data:catalog:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const baseUrl = (() => {
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
  })();

  const payload = {
    version: 1,
    publisher: { name: "SANE+", website: baseUrl },
    license: { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    generatedAt: new Date().toISOString(),
    endpoints: {
      datasets: `${baseUrl}/api/open-data/datasets`,
      dataset: `${baseUrl}/api/open-data/datasets/{id}`,
      schema: `${baseUrl}/api/open-data/datasets/{id}/schema`,
      data: `${baseUrl}/api/open-data/datasets/{id}/data`,
    },
    datasets: listOpenDataDatasets(baseUrl).map((d) => ({
      ...d,
      resources: [
        { format: "json", url: `${d.links.data}` },
        { format: "csv", url: `${d.links.data}?format=csv` },
        { format: "xlsx", url: `${d.links.data}?format=xlsx` },
      ],
      jsonSchema: { url: d.links.schema, version: d.schemaVersion },
    })),
  };

  return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
}
