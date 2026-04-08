import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NotificationsClient } from "./NotificationsClient";

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        title: true,
        message: true,
        createdAt: true,
        readAt: true,
      },
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/home" />
        <Link href="/home" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-3xl mx-auto">
          <h1 className="font-title font-bold text-2xl">Notificações</h1>

          <NotificationsClient
            initial={{
              items: items.map((n) => ({
                ...n,
                createdAt: n.createdAt.toISOString(),
                readAt: n.readAt ? n.readAt.toISOString() : null,
              })),
              unreadCount,
            }}
          />

          <div className="mt-10">
            <div className="font-title font-bold text-lg">Alertas</div>
            <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Card className="p-5">
                <div className="font-title font-semibold">
                  Manutenção programada no bairro X.
                </div>
                <div className="text-sm text-foreground/70 mt-1">
                  Verifique horários e prepare-se para possíveis interrupções.
                </div>
              </Card>
              <Card className="p-5">
                <div className="font-title font-semibold">
                  Alto volume de reclamações na região Y.
                </div>
                <div className="text-sm text-foreground/70 mt-1">
                  Acompanhe atualizações e registre sua ocorrência se necessário.
                </div>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
