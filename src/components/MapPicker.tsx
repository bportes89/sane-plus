"use client";

import { useEffect, useRef, useState } from "react";
import type { DivIcon, LeafletMouseEvent, Map as LeafletMap, Marker, TileLayer } from "leaflet";

const DEFAULT_BRAZIL_CENTER = {
  lat: -14.235,
  lng: -51.9253,
};

export function MapPicker({
  lat,
  lng,
  onChange,
  height = 280,
  readOnly = false,
  label,
  describedBy,
  id,
}: {
  lat?: number;
  lng?: number;
  onChange?: (pos: { lat: number; lng: number }) => void;
  height?: number;
  readOnly?: boolean;
  label?: string;
  describedBy?: string;
  id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const markerRef = useRef<Marker | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const tileLayerRef = useRef<TileLayer | null>(null);
  const onChangeRef = useRef<typeof onChange>(onChange);
  const readOnlyRef = useRef(readOnly);
  const markerIconRef = useRef<DivIcon | null>(null);
  const providerIndexRef = useRef(0);
  const latestPositionRef = useRef<{ lat: number; lng: number } | null>(
    typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null,
  );
  const tilesRef = useRef<{ errors: number; firstAt: number; switched: boolean }>({
    errors: 0,
    firstAt: 0,
    switched: false,
  });
  const [tileStatus, setTileStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  useEffect(() => {
    latestPositionRef.current =
      typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
  }, [lat, lng]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled) return;
      const el = ref.current;
      if (!el) return;

      try {
        mapRef.current?.remove();
      } catch {}
      mapRef.current = null;
      markerRef.current = null;
      tileLayerRef.current = null;
      providerIndexRef.current = 0;
      tilesRef.current = { errors: 0, firstAt: 0, switched: false };
      setTileStatus("loading");

      const anyEl = el as unknown as { _leaflet_id?: unknown };
      if (anyEl._leaflet_id) {
        try {
          delete anyEl._leaflet_id;
        } catch {
          anyEl._leaflet_id = undefined;
        }
      }

      const initialLat = latestPositionRef.current?.lat ?? DEFAULT_BRAZIL_CENTER.lat;
      const initialLng = latestPositionRef.current?.lng ?? DEFAULT_BRAZIL_CENTER.lng;

      const map = L.map(el, {
        center: [initialLat, initialLng],
        zoom: latestPositionRef.current ? 15 : 4,
      });
      mapRef.current = map;

      const providers = [
        {
          url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
          opts: { subdomains: "abcd", retina: true },
        },
        {
          url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          opts: { subdomains: "abc", retina: false },
        },
        {
          url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
          opts: { subdomains: "abc", retina: false },
        },
      ];
      const attribution =
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

      function mountTiles(url: string, opts?: { subdomains?: string; retina?: boolean }) {
        if (!mapRef.current) return;
        try {
          tileLayerRef.current?.removeFrom(mapRef.current);
        } catch {}
        tileLayerRef.current = null;

        const tileOptions: Record<string, unknown> = { attribution, maxZoom: 19 };
        if (opts?.subdomains) tileOptions.subdomains = opts.subdomains;
        if (opts?.retina) tileOptions.detectRetina = true;

        const layer = L.tileLayer(url, tileOptions);

        layer.on("tileload", () => {
          setTileStatus((s) => (s === "ok" ? s : "ok"));
        });

        layer.on("tileerror", () => {
          const s = tilesRef.current;
          const now = Date.now();
          if (!s.firstAt || now - s.firstAt > 3000) {
            s.firstAt = now;
            s.errors = 0;
          }
          s.errors += 1;
          if (s.errors >= 2 && mapRef.current) {
            s.switched = true;
            const next = providerIndexRef.current + 1;
            if (next >= providers.length) {
              setTileStatus((prev) => (prev === "ok" ? prev : "error"));
              return;
            }
            providerIndexRef.current = next;
            tilesRef.current = { errors: 0, firstAt: 0, switched: false };
            const p = providers[next];
            mountTiles(p.url, p.opts);
          }
        });

        layer.addTo(mapRef.current);
        tileLayerRef.current = layer;
      }

      const initialProvider = providers[providerIndexRef.current];
      mountTiles(initialProvider.url, initialProvider.opts);

      if (!markerIconRef.current) {
        markerIconRef.current = L.divIcon({
          className: "saneplus-marker",
          html: '<div style="width:18px;height:18px;border-radius:9999px;background:#9B4DFF;border:3px solid #ffffff;box-shadow:0 6px 16px rgba(0,0,0,.25);"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
      }

      function setMarker(p: { lat: number; lng: number }) {
        if (!mapRef.current) return;
        if (markerRef.current) {
          markerRef.current.setLatLng(p);
          return;
        }
        markerRef.current = L.marker(p, { icon: markerIconRef.current ?? undefined }).addTo(mapRef.current);
      }

      const initialMarker = latestPositionRef.current;
      if (initialMarker) {
        setMarker(initialMarker);
        try {
          map.setView([initialMarker.lat, initialMarker.lng], 15, { animate: false });
        } catch {}
      }

      map.on("click", (e: LeafletMouseEvent) => {
        if (readOnlyRef.current) return;
        const p = { lat: e.latlng.lat, lng: e.latlng.lng };
        setMarker(p);
        onChangeRef.current?.(p);
      });

      map.whenReady(() => {
        window.setTimeout(() => {
          try {
            map.invalidateSize();
          } catch {}
        }, 50);
      });
    })();

    return () => {
      cancelled = true;
      try {
        mapRef.current?.remove();
      } catch {}
      mapRef.current = null;
      markerRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    if (typeof lat !== "number" || typeof lng !== "number") {
      if (markerRef.current) {
        try {
          markerRef.current.remove();
        } catch {}
        markerRef.current = null;
      }
      return;
    }
    (async () => {
      const L = await import("leaflet");
      if (!mapRef.current) return;
      const p = { lat, lng };
      latestPositionRef.current = p;
      if (markerRef.current) {
        markerRef.current.setLatLng(p);
      } else {
        markerRef.current = L.marker(p, { icon: markerIconRef.current ?? undefined }).addTo(mapRef.current);
      }
      try {
        const currentZoom = mapRef.current.getZoom();
        mapRef.current.setView([p.lat, p.lng], Math.max(15, currentZoom), { animate: false });
      } catch {}
    })();
  }, [lat, lng]);

  return (
    <div
      id={id}
      role="region"
      tabIndex={0}
      aria-label={label ?? "Mapa para selecionar localização"}
      aria-describedby={describedBy}
      style={{ height }}
      className="relative rounded-2xl overflow-hidden"
    >
      <div ref={ref} className="h-full w-full" />
      {tileStatus === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/40">
          <div className="rounded-xl bg-white/90 px-4 py-2 text-sm text-foreground/80">
            Carregando mapa…
          </div>
        </div>
      ) : null}
      {tileStatus === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/40">
          <div className="max-w-[90%] rounded-xl bg-white/90 px-4 py-3 text-sm text-foreground/80">
            Não foi possível carregar o mapa. Verifique sua conexão e bloqueadores (VPN/AdBlock) e tente novamente.
          </div>
        </div>
      ) : null}
    </div>
  );
}
