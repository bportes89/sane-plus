import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { UserRole } from "@/generated/prisma/client";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

export default async function AlertsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const where =
    user.role === UserRole.COMPANY && user.companyId
      ? { companyId: user.companyId, resolvedAt: null }
      : isStaff(user.role)
        ? { resolvedAt: null }
        : null;

  if (!where) redirect("/home");

  const alerts = await prisma.dataAlert.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 80,
    select: {
      id: true,
      scope: true,
      type: true,
      title: true,
      message: true,
      severity: true,
      createdAt: true,
      companyId: true,
      city: true,
      state: true,
    },
  });

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/home" />
        <div className="flex items-center gap-4">
          {isStaff(user.role) ? (
            <Link href="/prefeitura/dashboard" className="text-sm text-primary hover:text-highlight">
              Dashboard
            </Link>
          ) : (
            <Link href="/company/dashboard" className="text-sm text-primary hover:text-highlight">
              Dashboard
            </Link>
          )}
        </div>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="font-title font-bold text-2xl">Alertas</h1>
            <div className="text-sm text-foreground/70 mt-1">
              Detecções automáticas de recorrência, picos e queda de performance.
            </div>
          </div>

          <Card className="p-5">
            {!alerts.length ? (
              <div className="text-sm text-foreground/70">Nenhum alerta aberto.</div>
            ) : (
              <div className="grid gap-3">
                {alerts.map((a) => (
                  <div key={a.id} className="rounded-2xl border border-black/10 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-title font-semibold">{a.title}</div>
                      <div className="text-xs text-foreground/60">
                        {new Date(a.createdAt).toLocaleString("pt-BR")}
                      </div>
                    </div>
                    <div className="text-sm text-foreground/80 mt-1">{a.message}</div>
                    <div className="text-xs text-foreground/60 mt-2">
                      {a.scope}
                      {a.severity ? ` • ${a.severity}` : ""}
                      {a.city && a.state ? ` • ${a.city}/${a.state}` : ""}
                      {a.companyId ? ` • Empresa: ${a.companyId}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}

