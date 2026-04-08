import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";

type ViaCepDto = {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
};

type NominatimItem = { lat?: string; lon?: string };

async function fetchJson<T>(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) return { ok: false as const, status: res.status, data: null as T | null };
  const data = (await res.json().catch(() => null)) as T | null;
  if (!data) return { ok: false as const, status: 502, data: null as T | null };
  return { ok: true as const, status: res.status, data };
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `geo:cep:${ip}`, limit: 120, windowMs: 60_000 });
  const headers = rateLimitHeaders(rl);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
  }

  const url = new URL(req.url);
  const raw = (url.searchParams.get("cep") ?? "").trim();
  const cep = raw.replace(/\D/g, "");
  if (cep.length !== 8) {
    return NextResponse.json({ error: "invalid_cep" }, { status: 400, headers });
  }

  const viaCepUrl = `https://viacep.com.br/ws/${cep}/json/`;
  const via = await fetchJson<ViaCepDto>(viaCepUrl, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!via.ok || !via.data || via.data.erro) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  }

  const street = (via.data.logradouro ?? "").trim() || null;
  const neighborhood = (via.data.bairro ?? "").trim() || null;
  const city = (via.data.localidade ?? "").trim() || null;
  const state = (via.data.uf ?? "").trim() || null;

  const ua = "SANE+ (dev) - CEP lookup";
  const nominatimHeaders = {
    "user-agent": ua,
    accept: "application/json",
    "accept-language": "pt-BR,pt;q=0.9,en;q=0.6",
  };

  async function geocode(searchUrl: string) {
    const r = await fetchJson<NominatimItem[]>(searchUrl, {
      headers: nominatimHeaders,
      cache: "no-store",
    });
    if (!r.ok || !r.data || !Array.isArray(r.data) || r.data.length === 0) return null;
    const first = r.data[0] ?? null;
    const lat = first?.lat ? Number(first.lat) : null;
    const lng = first?.lon ? Number(first.lon) : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat: lat as number, lng: lng as number };
  }

  const base = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br";
  const byPostal = await geocode(`${base}&postalcode=${encodeURIComponent(cep)}`);

  const query = [street, neighborhood, city, state, "Brasil"].filter(Boolean).join(", ") || `${cep}, Brasil`;
  const byQuery =
    byPostal ?? (await geocode(`${base}&q=${encodeURIComponent(query)}`));

  const label = [street, neighborhood, city && state ? `${city}/${state}` : city || state]
    .filter(Boolean)
    .join(", ");

  return NextResponse.json(
    {
      cep,
      street,
      neighborhood,
      city,
      state,
      lat: byQuery?.lat ?? null,
      lng: byQuery?.lng ?? null,
      label: label || null,
    },
    { headers },
  );
}

