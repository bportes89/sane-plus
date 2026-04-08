import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { UserRole } from "@/generated/prisma/client";
import { SupportAdminAutomationsClient } from "./SupportAdminAutomationsClient";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export default async function SupportAdminAutomationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/home");

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/support/admin" />
        <Link href="/support/admin" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="font-title font-bold text-2xl">Automações</h1>
            <div className="text-sm text-foreground/70 mt-1">Regras configuráveis (gatilhos → ações).</div>
          </div>

          <SupportAdminAutomationsClient />
        </div>
      </main>
    </div>
  );
}

