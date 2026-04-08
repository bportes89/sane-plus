"use client";

import useSWR from "swr";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { Card } from "@/components/Card";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type ComplaintListItem = {
  id: string;
  issue: string;
  status: string;
  createdAt: string;
  locationLat: number | null;
  locationLng: number | null;
  locationLabel: string | null;
  company: { name: string };
};

export default function ComplaintsListPage() {
  const { data, error, isLoading } = useSWR<ComplaintListItem[]>(
    "/api/complaints",
    fetcher,
  );
  const [showMap, setShowMap] = useState(false);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const elRef = useRef<HTMLDivElement>(null);

  const points = useMemo(
    () =>
      (data ?? [])
        .filter((c) => typeof c.locationLat === "number" && typeof c.locationLng === "number")
        .map((c) => ({
          id: c.id,
          lat: c.locationLat as number,
          lng: c.locationLng as number,
          title: c.issue,
          company: c.company.name,
          label: c.locationLabel,
        })),
    [data],
  );

  useEffect(() => {
    if (!showMap) return;
    if (!elRef.current) return;

    let cancelled = false;

    async function init() {
      const L = await import("leaflet");
      if (cancelled) return;
      if (!elRef.current) return;

      const center =
        points.length > 0
          ? {
              lat: points.reduce((a, p) => a + p.lat, 0) / points.length,
              lng: points.reduce((a, p) => a + p.lng, 0) / points.length,
            }
          : { lat: -23.55, lng: -46.63 };

      const map = L.map(elRef.current, {
        center: [center.lat, center.lng],
        zoom: points.length > 0 ? 11 : 12,
      });
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      markersRef.current = points.map((p) => {
        const marker = L.marker([p.lat, p.lng]).addTo(map);
        marker.bindPopup(
          `<div style="font-weight:600">${p.company}</div><div style="font-size:12px;opacity:.8">${p.title}</div>`,
        );
        marker.on("click", () => {
          window.location.href = `/complaints/${p.id}`;
        });
        return marker;
      });
    }

    init();
    return () => {
      cancelled = true;
      try {
        for (const m of markersRef.current) {
          try {
            m.remove();
          } catch {}
        }
        markersRef.current = [];
        mapRef.current?.remove();
        mapRef.current = null;
      } catch {}
    };
  }, [showMap, points]);

  if (isLoading) return <div className="p-6">Carregando...</div>;
  if (error) return <div className="p-6">Erro ao carregar</div>;

  return (
    <div className="px-6 py-8">
      <h1 className="font-title font-bold text-2xl">Minhas Reclamações</h1>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowMap((v) => !v)}
          className="text-sm text-primary hover:text-highlight"
        >
          {showMap ? "Ocultar mapa" : "Ver no mapa"}
        </button>
      </div>

      {showMap ? (
        <Card className="mt-4 p-3">
          <div ref={elRef} className="rounded-2xl overflow-hidden" style={{ height: 320 }} />
          {!points.length ? (
            <div className="text-xs text-foreground/60 mt-2">
              Nenhuma reclamação com localização marcada.
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="mt-4 grid gap-2">
        {data?.length ? (
          data.map((c) => (
            <Link
              key={c.id}
              href={`/complaints/${c.id}`}
              className="rounded-xl bg-white border border-black/10 px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{c.company.name}</span>
                <span className="text-sm text-foreground/70">{c.status}</span>
              </div>
              <div className="text-sm text-foreground/80">{c.issue}</div>
              {c.locationLabel ? (
                <div className="text-xs text-foreground/60 mt-1">{c.locationLabel}</div>
              ) : null}
              <div className="text-xs text-foreground/60">
                {new Date(c.createdAt).toLocaleString("pt-BR")}
              </div>
            </Link>
          ))
        ) : (
          <div className="text-foreground/70">Nenhuma reclamação encontrada.</div>
        )}
      </div>
    </div>
  );
}
