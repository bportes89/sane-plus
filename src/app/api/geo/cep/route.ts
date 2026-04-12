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

type NominatimItem = {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: {
    postcode?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    state_code?: string;
    country_code?: string;
  };
};

const UF_TO_STATE: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

async function fetchJson<T>(url: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false as const, status: 502, data: null as T | null };
  }
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

  const normalize = (value: string | null | undefined) =>
    (value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const normalizedState = normalize(state);
  const normalizedStateName = normalize(state ? UF_TO_STATE[state] ?? state : null);
  const normalizedCity = normalize(city);
  const normalizedStreet = normalize(street);
  const normalizedNeighborhood = normalize(neighborhood);
  const searchState = state ? UF_TO_STATE[state] ?? state : null;

  function stateMatches(value: string | null | undefined) {
    const normalizedValue = normalize(value);
    if (!normalizedValue) return false;
    return normalizedValue === normalizedState || normalizedValue === normalizedStateName;
  }

  function toCandidate(item: NominatimItem, searchRank: number) {
    const lat = item.lat ? Number(item.lat) : null;
    const lng = item.lon ? Number(item.lon) : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat: lat as number,
      lng: lng as number,
      address: item.address ?? {},
      searchRank,
    };
  }

  function scoreCandidate(candidate: NonNullable<ReturnType<typeof toCandidate>>) {
    const address = candidate.address;
    const itemCity = normalize(
      address.city ?? address.town ?? address.village ?? address.municipality ?? null,
    );
    const itemStateCode = normalize(address.state_code ?? null);
    const itemStateName = normalize(address.state ?? null);
    const itemRoad = normalize(address.road ?? null);
    const itemNeighborhood = normalize(address.neighbourhood ?? address.suburb ?? null);
    const itemCep = (address.postcode ?? "").replace(/\D/g, "");

    let score = candidate.searchRank;
    if (itemCep === cep) score += 12;
    if (normalizedState && (itemStateCode === normalizedState || stateMatches(address.state))) score += 8;
    if (normalizedCity && itemCity === normalizedCity) score += 8;
    if (normalizedStreet && (itemRoad === normalizedStreet || itemRoad.includes(normalizedStreet))) score += 5;
    if (
      normalizedNeighborhood &&
      (itemNeighborhood === normalizedNeighborhood || itemNeighborhood.includes(normalizedNeighborhood))
    ) {
      score += 4;
    }
    if ((address.country_code ?? "").toLowerCase() === "br") score += 1;
    if (normalizedState && itemStateCode && itemStateCode !== normalizedState) score -= 6;
    if (normalizedState && itemStateName && !stateMatches(address.state)) score -= 6;
    if (normalizedCity && itemCity && itemCity !== normalizedCity) score -= 6;
    return score;
  }

  async function geocode(searchUrl: string, searchRank: number) {
    const r = await fetchJson<NominatimItem[]>(searchUrl, {
      headers: nominatimHeaders,
      cache: "no-store",
    });
    if (!r.ok || !r.data || !Array.isArray(r.data) || r.data.length === 0) return [];
    return r.data
      .map((item) => toCandidate(item, searchRank))
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  const base = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=br";
  const structuredParams = new URLSearchParams({
    postalcode: cep,
    country: "Brasil",
  });
  if (street) structuredParams.set("street", street);
  if (city) structuredParams.set("city", city);
  if (searchState) structuredParams.set("state", searchState);
  const queries = [
    { url: `${base}&${structuredParams.toString()}`, rank: 30 },
    {
      url: `${base}&q=${encodeURIComponent(
        [street, neighborhood, city, searchState, "Brasil", cep].filter(Boolean).join(", "),
      )}`,
      rank: 26,
    },
    {
      url: `${base}&q=${encodeURIComponent([street, city, searchState, "Brasil"].filter(Boolean).join(", "))}`,
      rank: 23,
    },
    {
      url: `${base}&q=${encodeURIComponent([neighborhood, city, searchState, "Brasil"].filter(Boolean).join(", "))}`,
      rank: 18,
    },
    {
      url: `${base}&q=${encodeURIComponent([city, searchState, "Brasil", cep].filter(Boolean).join(", "))}`,
      rank: 14,
    },
    {
      url: `${base}&q=${encodeURIComponent([city, searchState, "Brasil"].filter(Boolean).join(", "))}`,
      rank: 10,
    },
    { url: `${base}&postalcode=${encodeURIComponent(cep)}`, rank: 8 },
  ];

  const allCandidates = (
    await Promise.all(queries.map((entry) => geocode(entry.url, entry.rank)))
  ).flat();

  const bestCandidate = [...allCandidates]
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0] ?? null;

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
      lat: bestCandidate?.lat ?? null,
      lng: bestCandidate?.lng ?? null,
      label: label || null,
    },
    { headers },
  );
}
