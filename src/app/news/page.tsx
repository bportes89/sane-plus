import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Card } from "@/components/Card";

export default async function NewsPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/" />
        <Link href="/home" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10 space-y-10">
        <section className="space-y-3">
          <h1 className="font-title font-bold text-2xl">Alertas</h1>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="p-5">
              <div className="font-title font-semibold">Manutenção programada</div>
              <div className="text-sm text-foreground/70 mt-1">
                Possível interrupção de água no bairro X entre 08:00 e 12:00.
              </div>
            </Card>
            <Card className="p-5">
              <div className="font-title font-semibold">Alto volume de reclamações</div>
              <div className="text-sm text-foreground/70 mt-1">
                Aumento de relatos na região Y nas últimas 24h.
              </div>
            </Card>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-title font-bold text-xl">Notícias</h2>
          <div className="grid grid-cols-1 gap-3">
            <Card className="p-5">
              <div className="font-title font-semibold">Transparência no saneamento</div>
              <div className="text-sm text-foreground/70 mt-1">
                Boas práticas de acompanhamento e participação cidadã.
              </div>
              <div className="text-xs text-foreground/60 mt-2">Fonte: SANE+ • Hoje</div>
            </Card>
            <Card className="p-5">
              <div className="font-title font-semibold">Como registrar uma reclamação</div>
              <div className="text-sm text-foreground/70 mt-1">
                Um passo a passo simples para descrever o problema e anexar evidências.
              </div>
              <div className="text-xs text-foreground/60 mt-2">Fonte: SANE+ • Hoje</div>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}
