import Link from "next/link";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { categories } from "@/lib/categories";

export default async function SearchPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const qRaw = props.searchParams?.q;
  const q = (Array.isArray(qRaw) ? qRaw[0] : qRaw)?.trim() ?? "";
  const user = await getCurrentUser();

  const companies =
    q.length >= 2
      ? await prisma.company.findMany({
          where: { name: { contains: q } },
          take: 12,
          select: { id: true, name: true },
        })
      : [];

  const complaints =
    user && q.length >= 2
      ? await prisma.complaint.findMany({
          where: {
            userId: user.id,
            OR: [
              { issue: { contains: q } },
              { description: { contains: q } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 12,
          select: {
            id: true,
            issue: true,
            status: true,
            createdAt: true,
            company: { select: { name: true } },
          },
        })
      : [];

  const allCategoryLabels = [
    ...Object.keys(categories),
    ...Object.values(categories).flat(),
  ];
  const matchedCategories =
    q.length >= 2
      ? allCategoryLabels
          .filter((x) => x.toLowerCase().includes(q.toLowerCase()))
          .slice(0, 12)
      : [];

  const statusLabel: Record<string, string> = {
    REGISTERED: "Aberta",
    NEEDS_REVIEW: "Em análise",
    PUBLISHED: "Publicada",
    COMPANY_REPLIED: "Respondida",
    USER_CONTESTED: "Contestada",
    RESOLVED: "Resolvida",
    CLOSED: "Encerrada",
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
        <div className="w-full max-w-3xl mx-auto">
          <h1 className="font-title font-bold text-2xl">Busca</h1>

          <form className="mt-5" action="/search" method="GET">
            <input
              name="q"
              defaultValue={q}
              placeholder="Buscar empresa ou problema"
              aria-label="Buscar empresa ou problema"
              autoComplete="off"
              className="w-full h-12 rounded-2xl border border-black/10 bg-white px-4 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
            />
          </form>

          <div className="mt-8 space-y-8">
            <section className="space-y-3">
              <h2 className="font-title font-bold text-lg">Resultados — Empresas</h2>
              <div className="grid gap-2">
                {companies.map((c) => (
                  <Link key={c.id} href={`/companies/${c.id}`} className="block">
                    <Card className="p-5 hover:bg-muted transition-colors">
                      <div className="font-title font-semibold">{c.name}</div>
                    </Card>
                  </Link>
                ))}
                {q.length >= 2 && !companies.length ? (
                  <Card className="p-5">
                    <div className="text-sm text-foreground/70">
                      Nenhuma empresa encontrada.
                    </div>
                  </Card>
                ) : null}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="font-title font-bold text-lg">Resultados — Reclamações</h2>
              <div className="grid gap-2">
                {complaints.map((c) => (
                  <Link key={c.id} href={`/complaints/${c.id}`} className="block">
                    <Card className="p-5 hover:bg-muted transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-title font-semibold">{c.issue}</div>
                          <div className="text-sm text-foreground/70 mt-1">
                            {c.company.name}
                          </div>
                        </div>
                        <div className="text-right text-xs text-foreground/60">
                          <div>{statusLabel[c.status] ?? c.status}</div>
                          <div>{new Date(c.createdAt).toLocaleDateString("pt-BR")}</div>
                        </div>
                      </div>
                    </Card>
                  </Link>
                ))}
                {q.length >= 2 && user && !complaints.length ? (
                  <Card className="p-5">
                    <div className="text-sm text-foreground/70">
                      Nenhuma reclamação encontrada.
                    </div>
                  </Card>
                ) : null}
                {q.length >= 2 && !user ? (
                  <Card className="p-5">
                    <div className="text-sm text-foreground/70">
                      Entre para buscar nas suas reclamações.
                    </div>
                  </Card>
                ) : null}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="font-title font-bold text-lg">Resultados — Categorias</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {matchedCategories.map((c) => (
                  <Card key={c} className="p-5">
                    <div className="font-title font-semibold">{c}</div>
                  </Card>
                ))}
                {q.length >= 2 && !matchedCategories.length ? (
                  <Card className="p-5">
                    <div className="text-sm text-foreground/70">
                      Nenhuma categoria encontrada.
                    </div>
                  </Card>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
