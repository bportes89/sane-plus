import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { Card } from "@/components/Card";
import { UserRole } from "@/generated/prisma/client";

export default async function SupportHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const staff = user.role === UserRole.MODERATOR || user.role === UserRole.ADMIN || user.role === UserRole.LEGAL;

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/home" />
        <Link href="/home" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="font-title font-bold text-2xl">Suporte SANE+</h1>
            <div className="text-sm text-foreground/70 mt-1">
              Atendimento acolhedor, claro e seguro.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Link href="/support/chat" className="block">
              <Card className="p-6 hover:bg-muted transition-colors">
                <div className="font-title font-semibold">Chat no app</div>
                <div className="text-sm text-foreground/70 mt-1">
                  Abra um chamado, acompanhe e avalie o atendimento.
                </div>
              </Card>
            </Link>
            <Link href="/support/faq" className="block">
              <Card className="p-6 hover:bg-muted transition-colors">
                <div className="font-title font-semibold">FAQ</div>
                <div className="text-sm text-foreground/70 mt-1">
                  Perguntas frequentes e tutoriais rápidos.
                </div>
              </Card>
            </Link>
          </div>

          <Card className="p-6">
            <div className="font-title font-semibold">E-mail</div>
            <div className="text-sm text-foreground/70 mt-1">
              Casos mais complexos: suporte@saneplus.com
            </div>
            <div className="text-xs text-foreground/60 mt-2">
              Nunca envie CPF, RG, endereço completo, dados bancários ou dados de terceiros.
            </div>
          </Card>

          {staff ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Link href="/support/admin" className="block">
                <Card className="p-6 hover:bg-muted transition-colors">
                  <div className="font-title font-semibold">Painel do suporte</div>
                  <div className="text-sm text-foreground/70 mt-1">
                    Fila de chamados, indicadores e respostas padrão.
                  </div>
                </Card>
              </Link>
              <Link href="/support/a11y" className="block">
                <Card className="p-6 hover:bg-muted transition-colors">
                  <div className="font-title font-semibold">Checklist de acessibilidade</div>
                  <div className="text-sm text-foreground/70 mt-1">
                    Validação manual do Módulo 10 (teclado, zoom, leitores de tela e contraste).
                  </div>
                </Card>
              </Link>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
