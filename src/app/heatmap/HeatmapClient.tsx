"use client";

import useSWR from "swr";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";

type MapPoint = {
  id: string;
  companyId: string;
  companyName: string;
  category: string;
  status: string;
  visibility: string;
  createdAt: string;
  lat: number;
  lng: number;
  locationLabel: string | null;
  title: string;
};

type CompanyOption = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
};

type Hotspot = {
  key: string;
  lat: number;
  lng: number;
  count: number;
  title: string;
  categories: string[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function intensityColor(value: number) {
  if (value >= 0.85) return "#D7263D";
  if (value >= 0.65) return "#F25F5C";
  if (value >= 0.45) return "#FF8C42";
  if (value >= 0.25) return "#9B4DFF";
  return "#5F3DC4";
}

function categoryLabel(category: string) {
  if (category === "WATER") return "Água";
  if (category === "SEWER") return "Esgoto";
  if (category === "INFRASTRUCTURE") return "Infraestrutura";
  if (category === "FINANCIAL") return "Financeiro";
  return "Atendimento";
}

export function HeatmapClient() {
  const [bucket, setBucket] = useState<"all" | "open" | "resolved" | "closed">("all");
  const [category, setCategory] = useState<string>("all");
  const [companyId, setCompanyId] = useState<string>("all");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [limit, setLimit] = useState("300");
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const pointsRef = useRef<MapPoint[]>([]);
  const didFitBoundsRef = useRef(false);

  const { data: companies } = useSWR<CompanyOption[]>("/api/companies", fetcher, {
    revalidateOnFocus: false,
  });

  const mapUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(Math.max(50, Math.min(500, Number(limit) || 300))));
    if (bucket !== "all") params.set("bucket", bucket);
    if (category !== "all") params.set("category", category);
    if (companyId !== "all") params.set("companyId", companyId);
    if (city.trim() && state.trim()) {
      params.set("city", city.trim());
      params.set("state", state.trim().toUpperCase());
    }
    return `/api/complaints/map?${params.toString()}`;
  }, [bucket, category, companyId, city, state, limit]);

  const { data, isLoading } = useSWR<MapPoint[]>(mapUrl, fetcher, {
    revalidateOnFocus: false,
  });

  const points = useMemo(() => data ?? [], [data]);

  useEffect(() => {
    pointsRef.current = points;
    didFitBoundsRef.current = false;
  }, [points]);

  const cityOptions = useMemo(() => {
    if (!companies?.length) return [];
    const unique = new Set<string>();
    for (const item of companies) {
      if (!item.city || !item.state) continue;
      unique.add(`${item.city}||${item.state}`);
    }
    return [...unique].map((value) => {
      const [optionCity, optionState] = value.split("||");
      return { city: optionCity ?? "", state: optionState ?? "" };
    }).sort((a, b) => `${a.city}${a.state}`.localeCompare(`${b.city}${b.state}`));
  }, [companies]);

  const hotspots = useMemo<Hotspot[]>(() => {
    const buckets = new Map<
      string,
      { latSum: number; lngSum: number; count: number; labels: string[]; categories: Record<string, number> }
    >();

    for (const point of points) {
      const latKey = Math.round(point.lat / 0.015);
      const lngKey = Math.round(point.lng / 0.015);
      const key = `${latKey}:${lngKey}`;
      const current = buckets.get(key);
      if (!current) {
        buckets.set(key, {
          latSum: point.lat,
          lngSum: point.lng,
          count: 1,
          labels: [point.locationLabel ?? point.companyName],
          categories: { [point.category]: 1 },
        });
        continue;
      }
      current.latSum += point.lat;
      current.lngSum += point.lng;
      current.count += 1;
      current.labels.push(point.locationLabel ?? point.companyName);
      current.categories[point.category] = (current.categories[point.category] ?? 0) + 1;
    }

    return [...buckets.entries()]
      .map(([key, value]) => {
        const topLabel = value.labels.sort((a, b) => a.localeCompare(b))[0] ?? "Área sem identificação";
        const orderedCategories = Object.entries(value.categories)
          .sort((a, b) => b[1] - a[1])
          .map(([itemCategory]) => categoryLabel(itemCategory));
        return {
          key,
          lat: value.latSum / value.count,
          lng: value.lngSum / value.count,
          count: value.count,
          title: topLabel,
          categories: orderedCategories,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [points]);

  const stats = useMemo(() => {
    const companyCount = new Set(points.map((item) => item.companyId)).size;
    const maxDensity = hotspots[0]?.count ?? 0;
    const criticalAreas = hotspots.filter((item) => item.count >= 3).length;
    return {
      total: points.length,
      companyCount,
      maxDensity,
      criticalAreas,
    };
  }, [hotspots, points]);

  useEffect(() => {
    if (!elRef.current) return;

    let cancelled = false;

    async function init() {
      const L = await import("leaflet");
      if (cancelled || !elRef.current) return;

      const initialCenter =
        pointsRef.current.length > 0
          ? {
              lat: pointsRef.current.reduce((sum, point) => sum + point.lat, 0) / pointsRef.current.length,
              lng: pointsRef.current.reduce((sum, point) => sum + point.lng, 0) / pointsRef.current.length,
            }
          : { lat: -23.55, lng: -46.63 };

      const map = L.map(elRef.current, {
        center: [initialCenter.lat, initialCenter.lng],
        zoom: pointsRef.current.length > 0 ? 11 : 10,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      layerRef.current = L.layerGroup().addTo(map);

      const render = () => {
        if (!mapRef.current || !layerRef.current) return;

        try {
          layerRef.current.clearLayers();
        } catch {}

        const currentPoints = pointsRef.current;
        if (!currentPoints.length) return;

        const zoom = mapRef.current.getZoom();
        const cellPx = zoom <= 9 ? 150 : zoom <= 11 ? 120 : zoom <= 13 ? 92 : 72;
        const grouped = new Map<
          string,
          { count: number; latSum: number; lngSum: number; companies: Set<string>; categories: Record<string, number> }
        >();

        for (const point of currentPoints) {
          const projected = mapRef.current.project([point.lat, point.lng], zoom);
          const key = `${Math.floor(projected.x / cellPx)}:${Math.floor(projected.y / cellPx)}`;
          const current = grouped.get(key);
          if (!current) {
            grouped.set(key, {
              count: 1,
              latSum: point.lat,
              lngSum: point.lng,
              companies: new Set([point.companyName]),
              categories: { [point.category]: 1 },
            });
            continue;
          }
          current.count += 1;
          current.latSum += point.lat;
          current.lngSum += point.lng;
          current.companies.add(point.companyName);
          current.categories[point.category] = (current.categories[point.category] ?? 0) + 1;
        }

        const maxCount = Math.max(...[...grouped.values()].map((item) => item.count));
        const baseRadius = zoom <= 9 ? 950 : zoom <= 11 ? 700 : zoom <= 13 ? 480 : 320;

        for (const group of grouped.values()) {
          const intensity = maxCount > 0 ? group.count / maxCount : 0;
          const color = intensityColor(intensity);
          const lat = group.latSum / group.count;
          const lng = group.lngSum / group.count;
          const dominantCategory = Object.entries(group.categories).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "SERVICE";
          const scaledRadius = baseRadius * (0.9 + Math.sqrt(group.count) * 0.55);

          L.circle([lat, lng], {
            radius: scaledRadius * 1.8,
            stroke: false,
            fillColor: color,
            fillOpacity: 0.08 + intensity * 0.12,
            interactive: false,
          }).addTo(layerRef.current);

          L.circle([lat, lng], {
            radius: scaledRadius * 1.15,
            stroke: false,
            fillColor: color,
            fillOpacity: 0.14 + intensity * 0.18,
            interactive: false,
          }).addTo(layerRef.current);

          const core = L.circle([lat, lng], {
            radius: Math.max(120, scaledRadius * 0.55),
            color,
            weight: 1,
            fillColor: color,
            fillOpacity: 0.32 + intensity * 0.28,
          }).addTo(layerRef.current);

          core.bindPopup(
            `<div style="font-weight:700">${group.count} reclamações nesta área</div><div style="font-size:12px;opacity:.78;margin-top:4px">Categoria dominante: ${categoryLabel(dominantCategory)}</div><div style="font-size:12px;opacity:.78">Empresas impactadas: ${group.companies.size}</div>`,
          );

          if (group.count >= 2) {
            L.marker([lat, lng], {
              interactive: false,
              icon: L.divIcon({
                className: "",
                iconSize: [34, 34],
                iconAnchor: [17, 17],
                html: `<div style="width:34px;height:34px;border-radius:9999px;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid rgba(255,255,255,.92);box-shadow:0 8px 20px rgba(0,0,0,.18)">${group.count}</div>`,
              }),
            }).addTo(layerRef.current);
          }
        }

        if (!didFitBoundsRef.current && mapRef.current) {
          const bounds = L.latLngBounds(currentPoints.map((point) => [point.lat, point.lng] as [number, number]));
          if (bounds.isValid()) {
            mapRef.current.fitBounds(bounds, { padding: [28, 28] });
            didFitBoundsRef.current = true;
          }
        }
      };

      map.on("zoomend", render);
      map.on("moveend", render);
      render();
    }

    init();

    return () => {
      cancelled = true;
      try {
        layerRef.current?.clearLayers();
      } catch {}
      try {
        mapRef.current?.remove();
      } catch {}
      layerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !layerRef.current) return;
    (async () => {
      const L = await import("leaflet");
      if (!mapRef.current || !layerRef.current) return;
      if (!pointsRef.current.length) {
        layerRef.current.clearLayers();
        return;
      }
      const bounds = L.latLngBounds(pointsRef.current.map((point) => [point.lat, point.lng] as [number, number]));
      if (bounds.isValid()) {
        mapRef.current.fitBounds(bounds, { padding: [28, 28] });
      }
    })();
  }, [points]);

  return (
    <section className="mt-8 space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <div className="text-xs uppercase tracking-[0.14em] text-foreground/55">Pontos no mapa</div>
          <div className="mt-2 font-title text-3xl font-bold text-foreground">{stats.total}</div>
          <div className="mt-1 text-sm text-foreground/70">Reclamações públicas com localização válida</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-[0.14em] text-foreground/55">Focos críticos</div>
          <div className="mt-2 font-title text-3xl font-bold text-foreground">{stats.criticalAreas}</div>
          <div className="mt-1 text-sm text-foreground/70">Áreas com 3 ou mais ocorrências próximas</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-[0.14em] text-foreground/55">Maior concentração</div>
          <div className="mt-2 font-title text-3xl font-bold text-foreground">{stats.maxDensity}</div>
          <div className="mt-1 text-sm text-foreground/70">Reclamações acumuladas no hotspot mais intenso</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-[0.14em] text-foreground/55">Empresas impactadas</div>
          <div className="mt-2 font-title text-3xl font-bold text-foreground">{stats.companyCount}</div>
          <div className="mt-1 text-sm text-foreground/70">Concessionárias presentes na amostra filtrada</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="grid gap-2 lg:grid-cols-6">
          <select
            value={bucket}
            onChange={(e) => setBucket(e.target.value as typeof bucket)}
            aria-label="Filtro de status"
            className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none"
          >
            <option value="all">Todos os status</option>
            <option value="open">Em aberto</option>
            <option value="resolved">Resolvidas</option>
            <option value="closed">Encerradas</option>
          </select>

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filtro de categoria"
            className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none"
          >
            <option value="all">Todas as categorias</option>
            <option value="WATER">Água</option>
            <option value="SEWER">Esgoto</option>
            <option value="INFRASTRUCTURE">Infraestrutura</option>
            <option value="FINANCIAL">Financeiro</option>
            <option value="SERVICE">Atendimento</option>
          </select>

          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            aria-label="Filtro de empresa"
            className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none"
          >
            <option value="all">Todas as empresas</option>
            {(companies ?? []).map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>

          <select
            value={city && state ? `${city}||${state}` : "all"}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "all") {
                setCity("");
                setState("");
                return;
              }
              const [nextCity, nextState] = value.split("||");
              setCity((nextCity ?? "").trim());
              setState((nextState ?? "").trim());
            }}
            aria-label="Atalho de cidade"
            className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none"
          >
            <option value="all">Todas as cidades</option>
            {cityOptions.map((item) => (
              <option key={`${item.city}||${item.state}`} value={`${item.city}||${item.state}`}>
                {item.city} / {item.state}
              </option>
            ))}
          </select>

          <Input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Cidade"
            aria-label="Cidade"
          />

          <div className="grid grid-cols-2 gap-2">
            <Input
              value={state}
              onChange={(e) => setState(e.target.value.toUpperCase())}
              placeholder="UF"
              aria-label="UF"
            />
            <Input
              value={limit}
              onChange={(e) => setLimit(e.target.value.replace(/\D/g, "").slice(0, 3))}
              placeholder="Limite"
              aria-label="Limite de pontos"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-foreground/60">
          <span>Mais vermelho = maior concentração</span>
          <span>Mais roxo = menor concentração</span>
          <span>Clique em uma mancha para ver o resumo da área</span>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]">
        <Card className="p-3">
          <div ref={elRef} className="overflow-hidden rounded-2xl" style={{ height: 560 }} />
          <div className="mt-3 text-xs text-foreground/60">
            {isLoading
              ? "Atualizando o mapa de calor…"
              : points.length
                ? "As manchas representam a densidade de reclamações por região."
                : "Sem reclamações públicas com localização para os filtros atuais."}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="font-title text-lg font-bold text-foreground">Principais hotspots</div>
            <div className="mt-1 text-sm text-foreground/70">
              Áreas com maior concentração recente dentro dos filtros selecionados.
            </div>
            <div className="mt-4 space-y-3">
              {hotspots.length ? (
                hotspots.map((hotspot, index) => (
                  <button
                    key={hotspot.key}
                    type="button"
                    onClick={() => mapRef.current?.setView([hotspot.lat, hotspot.lng], 14)}
                    className="block w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-left transition hover:bg-muted"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-title text-sm font-semibold text-foreground">
                          {index + 1}. {hotspot.title}
                        </div>
                        <div className="mt-1 text-xs text-foreground/65">
                          Categoria dominante: {hotspot.categories[0] ?? "Atendimento"}
                        </div>
                      </div>
                      <div
                        className="inline-flex min-w-11 items-center justify-center rounded-full px-3 py-1 text-xs font-title font-semibold text-white"
                        style={{ backgroundColor: intensityColor((hotspot.count || 1) / Math.max(1, stats.maxDensity || 1)) }}
                      >
                        {hotspot.count}
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-sm text-foreground/70">Nenhum hotspot encontrado com os filtros atuais.</div>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <div className="font-title text-lg font-bold text-foreground">Como usar</div>
            <div className="mt-3 space-y-2 text-sm text-foreground/70">
              <div>Filtre por cidade, empresa, categoria e status para encontrar padrões locais.</div>
              <div>Use os hotspots laterais para aproximar rapidamente as áreas mais críticas.</div>
              <div>Combine essa tela com o ranking para identificar onde a operação precisa reagir mais rápido.</div>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
