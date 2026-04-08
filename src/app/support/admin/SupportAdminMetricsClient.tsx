"use client";

import useSWR from "swr";
import { Card } from "@/components/Card";

type Metrics = {
  windowDays: number;
  tickets: number;
  closed: number;
  reopened: number;
  avgFirstResponseMs: number | null;
  avgResolutionMs: number | null;
  avgSatisfaction: number | null;
  adjustedMessages: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function minutes(ms: number) {
  return Math.round(ms / 60000);
}

function hours(ms: number) {
  return Math.round(ms / 3600000);
}

export function SupportAdminMetricsClient() {
  const { data } = useSWR<Metrics>("/api/support/metrics", fetcher, {
    refreshInterval: 15000,
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Card className="p-6">
        <div className="text-xs text-foreground/60">Tempo médio de 1ª resposta ({data?.windowDays ?? 30}d)</div>
        <div className="font-title font-bold text-xl mt-1">
          {data?.avgFirstResponseMs == null ? "—" : `${minutes(data.avgFirstResponseMs)} min`}
        </div>
      </Card>
      <Card className="p-6">
        <div className="text-xs text-foreground/60">Tempo médio de resolução ({data?.windowDays ?? 30}d)</div>
        <div className="font-title font-bold text-xl mt-1">
          {data?.avgResolutionMs == null ? "—" : `${hours(data.avgResolutionMs)} h`}
        </div>
      </Card>
      <Card className="p-6">
        <div className="text-xs text-foreground/60">Satisfação média ({data?.windowDays ?? 30}d)</div>
        <div className="font-title font-bold text-xl mt-1">
          {data?.avgSatisfaction == null ? "—" : data.avgSatisfaction.toFixed(2)}
        </div>
        <div className="text-xs text-foreground/60 mt-1">
          Tickets: {data?.tickets ?? "—"} • Ajustes: {data?.adjustedMessages ?? "—"}
        </div>
        <div className="text-xs text-foreground/60 mt-1">
          Encerrados: {data?.closed ?? "—"} • Reabertos: {data?.reopened ?? "—"}
        </div>
      </Card>
    </div>
  );
}
