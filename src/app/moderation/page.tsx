import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { UserRole } from "@/generated/prisma/client";

export default async function ModerationQueuePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const allowedRoles: UserRole[] = [UserRole.MODERATOR, UserRole.LEGAL, UserRole.ADMIN];
  if (!allowedRoles.includes(user.role)) redirect("/home");

  const items = await prisma.complaint.findMany({
    where: {
      OR: [{ status: "NEEDS_REVIEW" }, { status: "USER_CONTESTED" }],
    },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      issue: true,
      category: true,
      status: true,
      createdAt: true,
      company: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  });

  const statusLabel: Record<string, string> = {
    NEEDS_REVIEW: "Em análise",
    USER_CONTESTED: "Contestada",
  };

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/home" />
        <Link href="/home" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-4xl mx-auto">
          <h1 className="font-title font-bold text-2xl">Fila de Moderação</h1>
          <div className="text-sm text-foreground/70 mt-1">
            Casos em análise, contestados ou com risco jurídico.
          </div>

          <div className="mt-6 grid gap-2">
            {items.map((c) => (
              <Link key={c.id} href={`/moderation/${c.id}`} className="block">
                <Card className="p-5 hover:bg-muted transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-title font-semibold">{c.issue}</div>
                      <div className="text-xs text-foreground/60 mt-1">
                        {c.company.name} •{" "}
                        {(c.user.name ?? c.user.email ?? "Usuário").toString()}
                      </div>
                    </div>
                    <div className="text-right text-xs text-foreground/60">
                      <div>{new Date(c.createdAt).toLocaleString("pt-BR")}</div>
                      <div>{statusLabel[c.status] ?? c.status}</div>
                      <div>
                        Prazo:{" "}
                        {new Date(
                          new Date(c.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000,
                        ).toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}

            {!items.length ? (
              <Card className="p-5">
                <div className="text-sm text-foreground/70">
                  Nenhum item pendente no momento.
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
