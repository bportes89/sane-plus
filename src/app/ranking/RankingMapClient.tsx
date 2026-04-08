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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function categoryColor(category: string) {
  if (category === "WATER") return "#1f6fb3";
  if (category === "SEWER") return "#5f3dc4";
  if (category === "INFRASTRUCTURE") return "#820ad1";
  if (category === "FINANCIAL") return "#9b4dff";
  return "#2b2b2b";
}

export function RankingMapClient(props?: {
  initialCity?: string;
  initialState?: string;
  showCityStateFilter?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [bucket, setBucket] = useState<"all" | "open" | "resolved" | "closed">("all");
  const [category, setCategory] = useState<string>("all");
  const [companyId, setCompanyId] = useState<string>("all");
  const [city, setCity] = useState<string>((props?.initialCity ?? "").trim());
  const [state, setState] = useState<string>((props?.initialState ?? "").trim());
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const pointsRef = useRef<MapPoint[]>([]);

  const { data: companies } = useSWR<{ id: string; name: string; city: string | null; state: string | null }[]>(
    show ? "/api/companies" : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  const mapUrl = useMemo(() => {
    if (!show) return null;
    const params = new URLSearchParams();
    params.set("limit", "300");
    if (bucket !== "all") params.set("bucket", bucket);
    if (category !== "all") params.set("category", category);
    if (companyId !== "all") params.set("companyId", companyId);
    if (props?.showCityStateFilter && city && state) {
      params.set("city", city);
      params.set("state", state);
    }
    return `/api/complaints/map?${params.toString()}`;
  }, [show, bucket, category, companyId, props?.showCityStateFilter, city, state]);

  const { data } = useSWR<MapPoint[]>(
    mapUrl,
    fetcher,
    { revalidateOnFocus: false },
  );

  const points = useMemo(() => data ?? [], [data]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  const cityOptions = useMemo(() => {
    if (!companies?.length) return [];
    const set = new Set<string>();
    for (const c of companies) {
      if (!c.city || !c.state) continue;
      set.add(`${c.city}||${c.state}`);
    }
    return [...set.values()]
      .map((k) => {
        const [c, s] = k.split("||");
        return { city: c ?? "", state: s ?? "" };
      })
      .sort((a, b) => (a.city + a.state).localeCompare(b.city + b.state));
  }, [companies]);

  useEffect(() => {
    if (!show) {
      try {
        layerRef.current?.clearLayers();
      } catch {}
      try {
        mapRef.current?.remove();
      } catch {}
      mapRef.current = null;
      layerRef.current = null;
      return;
    }
    if (!elRef.current) return;

    let cancelled = false;

    async function init() {
      const L = await import("leaflet");
      if (cancelled) return;
      if (!elRef.current) return;

      const initialCenter =
        pointsRef.current.length > 0
          ? {
              lat:
                pointsRef.current.reduce((a, p) => a + p.lat, 0) / pointsRef.current.length,
              lng:
                pointsRef.current.reduce((a, p) => a + p.lng, 0) / pointsRef.current.length,
            }
          : { lat: -23.55, lng: -46.63 };

      const map = L.map(elRef.current, {
        center: [initialCenter.lat, initialCenter.lng],
        zoom: pointsRef.current.length > 0 ? 11 : 12,
      });
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      const layer = L.layerGroup().addTo(map);
      layerRef.current = layer;

      function render() {
        if (!mapRef.current || !layerRef.current) return;
        const pts = pointsRef.current;
        try {
          layerRef.current.clearLayers();
        } catch {}
        if (!pts.length) return;

        const zoom = mapRef.current.getZoom();
        const cellPx = zoom <= 10 ? 110 : zoom <= 12 ? 85 : zoom <= 14 ? 65 : 50;

        const buckets = new Map<
          string,
          { latSum: number; lngSum: number; items: MapPoint[]; catCounts: Record<string, number> }
        >();

        for (const p of pts) {
          const pt = mapRef.current.project([p.lat, p.lng], zoom);
          const key = `${Math.floor(pt.x / cellPx)}:${Math.floor(pt.y / cellPx)}`;
          const b = buckets.get(key);
          if (!b) {
            buckets.set(key, {
              latSum: p.lat,
              lngSum: p.lng,
              items: [p],
              catCounts: { [p.category]: 1 },
            });
          } else {
            b.latSum += p.lat;
            b.lngSum += p.lng;
            b.items.push(p);
            b.catCounts[p.category] = (b.catCounts[p.category] ?? 0) + 1;
          }
        }

        for (const b of buckets.values()) {
          const count = b.items.length;
          const lat = b.latSum / count;
          const lng = b.lngSum / count;

          const dominantCategory = Object.entries(b.catCounts).sort((a, c) => c[1] - a[1])[0]?.[0];
          const color = categoryColor(dominantCategory ?? "SERVICE");

          if (count === 1) {
            const p = b.items[0];
            const when = new Date(p.createdAt).toLocaleDateString("pt-BR");
            const marker = L.circleMarker([p.lat, p.lng], {
              radius: 7,
              color,
              fillColor: color,
              fillOpacity: 0.9,
              weight: 2,
            }).addTo(layerRef.current);
            marker.bindPopup(
              `<div style="font-weight:600">${p.title}</div><div style="font-size:12px;opacity:.75">${when}</div>`,
            );
            marker.on("click", () => {
              window.location.href = `/companies/${p.companyId}`;
            });
          } else {
            const size = Math.max(34, Math.min(52, 28 + Math.round(Math.sqrt(count) * 8)));
            const marker = L.marker([lat, lng], {
              icon: L.divIcon({
                className: "",
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2],
                html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:${color};color:white;font-weight:700;border:2px solid rgba(255,255,255,.9);box-shadow:0 8px 20px rgba(0,0,0,.25);font-size:12px">${count}</div>`,
              }),
            }).addTo(layerRef.current);
            marker.bindPopup(
              `<div style="font-weight:600">${count} reclamações nesta área</div><div style="font-size:12px;opacity:.75">Aproxime para ver detalhes</div>`,
            );
            marker.on("click", () => {
              mapRef.current?.setView([lat, lng], Math.min(18, mapRef.current.getZoom() + 2));
            });
          }
        }
      }

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
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [show]);

  useEffect(() => {
    if (!show) return;
    if (!mapRef.current || !layerRef.current) return;
    (async () => {
      const L = await import("leaflet");
      if (!mapRef.current || !layerRef.current) return;
      const map = mapRef.current;
      const layer = layerRef.current;
      function rerender() {
        if (!mapRef.current || !layerRef.current) return;
        layer.clearLayers();
        const pts = pointsRef.current;
        if (!pts.length) return;
        const zoom = map.getZoom();
        const cellPx = zoom <= 10 ? 110 : zoom <= 12 ? 85 : zoom <= 14 ? 65 : 50;

        const buckets = new Map<
          string,
          { latSum: number; lngSum: number; items: MapPoint[]; catCounts: Record<string, number> }
        >();

        for (const p of pts) {
          const pt = map.project([p.lat, p.lng], zoom);
          const key = `${Math.floor(pt.x / cellPx)}:${Math.floor(pt.y / cellPx)}`;
          const b = buckets.get(key);
          if (!b) {
            buckets.set(key, {
              latSum: p.lat,
              lngSum: p.lng,
              items: [p],
              catCounts: { [p.category]: 1 },
            });
          } else {
            b.latSum += p.lat;
            b.lngSum += p.lng;
            b.items.push(p);
            b.catCounts[p.category] = (b.catCounts[p.category] ?? 0) + 1;
          }
        }

        for (const b of buckets.values()) {
          const count = b.items.length;
          const lat = b.latSum / count;
          const lng = b.lngSum / count;

          const dominantCategory = Object.entries(b.catCounts).sort((a, c) => c[1] - a[1])[0]?.[0];
          const color = categoryColor(dominantCategory ?? "SERVICE");

          if (count === 1) {
            const p = b.items[0];
            const when = new Date(p.createdAt).toLocaleDateString("pt-BR");
            const marker = L.circleMarker([p.lat, p.lng], {
              radius: 7,
              color,
              fillColor: color,
              fillOpacity: 0.9,
              weight: 2,
            }).addTo(layer);
            marker.bindPopup(
              `<div style="font-weight:600">${p.title}</div><div style="font-size:12px;opacity:.75">${when}</div>`,
            );
            marker.on("click", () => {
              window.location.href = `/companies/${p.companyId}`;
            });
          } else {
            const size = Math.max(34, Math.min(52, 28 + Math.round(Math.sqrt(count) * 8)));
            const marker = L.marker([lat, lng], {
              icon: L.divIcon({
                className: "",
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2],
                html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:${color};color:white;font-weight:700;border:2px solid rgba(255,255,255,.9);box-shadow:0 8px 20px rgba(0,0,0,.25);font-size:12px">${count}</div>`,
              }),
            }).addTo(layer);
            marker.bindPopup(
              `<div style="font-weight:600">${count} reclamações nesta área</div><div style="font-size:12px;opacity:.75">Aproxime para ver detalhes</div>`,
            );
            marker.on("click", () => {
              map.setView([lat, lng], Math.min(18, map.getZoom() + 2));
            });
          }
        }
      }

      rerender();
    })();
  }, [show, points]);

  return (
    <section className="mt-5">
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="text-sm text-primary hover:text-highlight"
      >
        {show ? "Ocultar mapa" : "Ver mapa de reclamações"}
      </button>

      {show ? (
        <Card className="mt-3 p-3">
          <div className="flex flex-col lg:flex-row gap-2 pb-3">
            <select
              value={bucket}
              onChange={(e) => setBucket(e.target.value as typeof bucket)}
              aria-label="Filtro de status"
              className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none"
            >
              <option value="all">Todas</option>
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
              {(companies ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {props?.showCityStateFilter ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 pb-3">
              <select
                value={city && state ? `${city}||${state}` : "all"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "all") {
                    setCity("");
                    setState("");
                    return;
                  }
                  const [c, s] = v.split("||");
                  setCity((c ?? "").trim());
                  setState((s ?? "").trim());
                }}
                aria-label="Filtro de cidade"
                className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none"
              >
                <option value="all">Todas as cidades</option>
                {cityOptions.map((x) => (
                  <option key={`${x.city}||${x.state}`} value={`${x.city}||${x.state}`}>
                    {x.city} / {x.state}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Cidade"
                  aria-label="Cidade"
                />
                <Input
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="UF"
                  aria-label="UF"
                />
              </div>
            </div>
          ) : null}

          <div ref={elRef} className="rounded-2xl overflow-hidden" style={{ height: 340 }} />
          {!points.length ? (
            <div className="text-xs text-foreground/60 mt-2">
              Sem reclamações públicas com localização marcada.
            </div>
          ) : (
            <div className="text-xs text-foreground/60 mt-2">
              Clique em um ponto para abrir a empresa. Clique em um agrupamento para aproximar.
            </div>
          )}
        </Card>
      ) : null}
    </section>
  );
}
