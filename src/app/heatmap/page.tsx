import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { HeatmapClient } from "./HeatmapClient";

export const dynamic = "force-dynamic";

export default async function HeatmapPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/heatmap&clear=1");

  return (
    <div className="min-h-dvh bg-background px-6 py-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="inline-flex items-center rounded-full border border-[#E7D7FF] bg-white px-3 py-1 text-[11px] font-title font-semibold uppercase tracking-[0.14em] text-[#820AD1]">
              Mapa de calor
            </div>
            <h1 className="mt-3 font-title text-3xl font-bold text-foreground">
              Concentração de reclamações por região
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-foreground/70">
              Visualize rapidamente onde estão os focos mais críticos de reclamações e identifique
              regiões com maior pressão sobre o saneamento.
            </p>
          </div>
          <Link href="/home" className="text-sm text-primary hover:text-highlight">
            Voltar
          </Link>
        </div>

        <HeatmapClient />
      </div>
    </div>
  );
}
