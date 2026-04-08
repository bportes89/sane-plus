import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { Card } from "@/components/Card";
import { UserRole } from "@/generated/prisma/client";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export default async function SupportA11yPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/home");

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/support" />
        <Link href="/support" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="font-title font-bold text-2xl">Checklist de Acessibilidade (Módulo 10)</h1>
            <div className="text-sm text-foreground/70 mt-1">
              Use esta página para validar teclado, zoom 200%, leitores de tela e alto contraste nas principais telas do MVP.
            </div>
          </div>

          <Card className="p-6 space-y-3">
            <div className="font-title font-bold text-lg">Preparação</div>
            <ul className="list-disc pl-5 text-sm text-foreground/80 space-y-1">
              <li>Desktop: Chrome/Edge. Mobile: Android (TalkBack) e iOS (VoiceOver).</li>
              <li>Ative zoom do navegador em 200% e confira se não há corte de texto nem conteúdo inacessível.</li>
              <li>Teste somente teclado: Tab, Shift+Tab, Enter, Espaço e Esc.</li>
              <li>Ative alto contraste e modo simplicidade em Perfil.</li>
            </ul>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href="/profile" className="text-sm text-primary hover:text-highlight">
                Abrir Perfil (modos A11Y)
              </Link>
              <Link href="/notifications" className="text-sm text-primary hover:text-highlight">
                Abrir Notificações (som/vibração)
              </Link>
              <Link href="/complaints/new" prefetch={false} className="text-sm text-primary hover:text-highlight">
                Abrir Nova Reclamação (3 passos)
              </Link>
            </div>
          </Card>

          <Card className="p-6 space-y-3">
            <div className="font-title font-bold text-lg">Critérios rápidos (passa/não passa)</div>
            <ul className="list-disc pl-5 text-sm text-foreground/80 space-y-1">
              <li>Existe um caminho completo por teclado para concluir a tarefa principal da tela.</li>
              <li>O foco visível aparece sempre e segue ordem lógica.</li>
              <li>Campos têm nome acessível (label/aria-label) e mensagens de erro são anunciadas.</li>
              <li>No zoom 200% não há sobreposição crítica nem perda de ação.</li>
              <li>Em alto contraste, texto e botões continuam legíveis e distinguíveis.</li>
            </ul>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="p-6 space-y-2">
              <div className="font-title font-bold text-lg">Fluxo: Reclamação</div>
              <ul className="list-disc pl-5 text-sm text-foreground/80 space-y-1">
                <li>Nova Reclamação: preencher e avançar em 3 passos só com teclado.</li>
                <li>Mapa: alternativa por lat/lng funciona sem mapa.</li>
                <li>Detalhe: botões “Resolvido/Contestar” são alcançáveis e nomeados.</li>
              </ul>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link href="/complaints/new" prefetch={false} className="text-sm text-primary hover:text-highlight">
                  Nova Reclamação
                </Link>
                <Link href="/home" className="text-sm text-primary hover:text-highlight">
                  Home
                </Link>
              </div>
            </Card>

            <Card className="p-6 space-y-2">
              <div className="font-title font-bold text-lg">Fluxo: Suporte</div>
              <ul className="list-disc pl-5 text-sm text-foreground/80 space-y-1">
                <li>Chat: anexar arquivo, digitar mensagem, enviar e encerrar por teclado.</li>
                <li>Alertas/erros: aparecem e são anunciados quando necessário.</li>
              </ul>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link href="/support/chat" className="text-sm text-primary hover:text-highlight">
                  Lista de Chamados
                </Link>
                <Link href="/support/admin" className="text-sm text-primary hover:text-highlight">
                  Painel do Suporte
                </Link>
              </div>
            </Card>

            <Card className="p-6 space-y-2">
              <div className="font-title font-bold text-lg">Fluxo: Ranking e Mapa</div>
              <ul className="list-disc pl-5 text-sm text-foreground/80 space-y-1">
                <li>Mapa: container tem nome acessível e filtros são navegáveis por teclado.</li>
                <li>Ranking: links e botões são identificáveis por leitor de tela.</li>
              </ul>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link href="/ranking" className="text-sm text-primary hover:text-highlight">
                  Ranking
                </Link>
              </div>
            </Card>

            <Card className="p-6 space-y-2">
              <div className="font-title font-bold text-lg">Notificações</div>
              <ul className="list-disc pl-5 text-sm text-foreground/80 space-y-1">
                <li>Leitor de tela anuncia chegada de novas notificações.</li>
                <li>Som/vibração só ocorrem com preferência ativada e suporte do dispositivo.</li>
              </ul>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link href="/notifications" className="text-sm text-primary hover:text-highlight">
                  Notificações
                </Link>
              </div>
            </Card>
          </div>

          <Card className="p-6 space-y-2">
            <div className="font-title font-bold text-lg">Evidência mínima para marcar “100%”</div>
            <ul className="list-disc pl-5 text-sm text-foreground/80 space-y-1">
              <li>Um vídeo curto (ou prints) de teclado + zoom 200% no fluxo de Reclamação.</li>
              <li>Um vídeo curto (ou prints) com TalkBack/VoiceOver navegando na Home e Notificações.</li>
              <li>Registro de ajustes necessários (se houver) e rerun de testes automatizados.</li>
            </ul>
          </Card>
        </div>
      </main>
    </div>
  );
}
