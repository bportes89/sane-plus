import Link from "next/link";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";

export default async function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/" />
        <Link href="/profile" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-3xl mx-auto">
          <h1 className="font-title font-bold text-2xl">Política de Privacidade</h1>
          <Card className="mt-5 p-6">
            <div className="text-sm text-foreground/80 leading-6">
              Conteúdo jurídico será inserido aqui (Política de Privacidade — SANE+ / LGPD).
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
