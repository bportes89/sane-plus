import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { UserRole, ComplaintStatus, ComplaintCategory } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";
import { CompanySettingsForm } from "./CompanySettingsForm";

export default async function CompanyPanelPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== UserRole.COMPANY || !user.companyId) redirect("/home");

  const openStatuses: ComplaintStatus[] = ["REGISTERED", "PUBLISHED", "USER_CONTESTED"];

  const statusFilterRaw = props.searchParams?.status;
  const statusFilter = Array.isArray(statusFilterRaw) ? statusFilterRaw[0] : statusFilterRaw;
  const categoryRaw = props.searchParams?.category;
  const categoryFilter = Array.isArray(categoryRaw) ? categoryRaw[0] : categoryRaw;
  const regionRaw = props.searchParams?.region;
  const regionFilter = Array.isArray(regionRaw) ? regionRaw[0] : regionRaw;
  const daysRaw = props.searchParams?.days;
  const days =
    Math.max(
      0,
      Math.min(
        365,
        Number.parseInt(Array.isArray(daysRaw) ? daysRaw[0] ?? "0" : daysRaw ?? "0", 10) || 0,
      ),
    );
  const now = new Date();
  const since = days > 0 ? new Date(now.getTime() - days * 24 * 60 * 60 * 1000) : null;

  const where: Prisma.ComplaintWhereInput = { companyId: user.companyId };
  if (since) where.createdAt = { gte: since };
  if (statusFilter === "OPEN") {
    where.status = { in: openStatuses };
  } else if (statusFilter && statusFilter !== "ALL") {
    const allowed: ComplaintStatus[] = [
      "REGISTERED",
      "NEEDS_REVIEW",
      "PUBLISHED",
      "COMPANY_REPLIED",
      "USER_CONTESTED",
      "RESOLVED",
      "CLOSED",
    ];
    if (allowed.includes(statusFilter as ComplaintStatus)) {
      where.status = statusFilter as ComplaintStatus;
    }
  }
  if (categoryFilter && categoryFilter !== "ALL") {
    where.category = categoryFilter as ComplaintCategory;
  }
  if (regionFilter && regionFilter.trim().length > 0) {
    const term = regionFilter.trim();
    where.OR = [
      { neighborhood: { contains: term } },
      { street: { contains: term } },
      { locationLabel: { contains: term } },
    ];
  }

  const [company, complaints, totals, resolvedCount, responses, companyUsers, overdueNoReply, openCount, repliedCount, contestedCount, closedCount] = await Promise.all([
    prisma.company.findUnique({
      where: { id: user.companyId },
      select: { id: true, name: true, overallScore: true, city: true, state: true, logoUrl: true },
    }),
    prisma.complaint.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 60,
      select: {
        id: true,
        issue: true,
        status: true,
        createdAt: true,
        responses: { take: 1, select: { id: true } },
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.complaint.count({ where: { companyId: user.companyId } }),
    prisma.complaint.count({ where: { companyId: user.companyId, status: "RESOLVED" } }),
    prisma.companyResponse.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, complaint: { select: { id: true, createdAt: true } } },
    }),
    prisma.user.findMany({
      where: { companyId: user.companyId, role: UserRole.COMPANY },
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.complaint.count({
      where: {
        companyId: user.companyId,
        status: { in: openStatuses },
        responses: { none: {} },
        createdAt: { lte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.complaint.count({
      where: {
        companyId: user.companyId,
        status: { in: openStatuses },
      },
    }),
    prisma.complaint.count({ where: { companyId: user.companyId, status: "COMPANY_REPLIED" } }),
    prisma.complaint.count({ where: { companyId: user.companyId, status: "USER_CONTESTED" } }),
    prisma.complaint.count({ where: { companyId: user.companyId, status: "CLOSED" } }),
  ]);

  const solutionRate = totals ? Math.round((resolvedCount / totals) * 100) : 0;

  const firstResponseByComplaint = new Map<string, Date>();
  for (const r of responses) {
    const cid = r.complaint.id;
    if (!firstResponseByComplaint.has(cid)) {
      firstResponseByComplaint.set(cid, new Date(r.createdAt));
    }
  }
  const diffs: number[] = [];
  for (const [cid, first] of firstResponseByComplaint.entries()) {
    const base = responses.find((r) => r.complaint.id === cid)?.complaint.createdAt;
    if (base) {
      diffs.push(new Date(first).getTime() - new Date(base).getTime());
    }
  }
  const avgResponseMs = diffs.length ? Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length) : null;
  const avgResponseHours = avgResponseMs !== null ? Math.max(1, Math.round(avgResponseMs / (60 * 60 * 1000))) : null;

  const statusLabel: Record<string, string> = {
    REGISTERED: "Aberta",
    NEEDS_REVIEW: "Em análise",
    PUBLISHED: "Publicada",
    COMPANY_REPLIED: "Respondida",
    USER_CONTESTED: "Contestada",
    RESOLVED: "Resolvida",
    CLOSED: "Encerrada",
  };

  const exportUrl = company
    ? `/api/companies/${company.id}/complaints/export?status=${encodeURIComponent(statusFilter ?? "ALL")}&category=${encodeURIComponent(categoryFilter ?? "ALL")}&region=${encodeURIComponent(regionFilter ?? "")}&days=${encodeURIComponent(String(days))}`
    : "";

  const overdueCutoffMs = now.getTime() - 24 * 60 * 60 * 1000;
  function isOverdueNoReply(c: { status: ComplaintStatus; createdAt: Date; responses: Array<{ id: string }> }) {
    return openStatuses.includes(c.status) && c.responses.length === 0 && c.createdAt.getTime() <= overdueCutoffMs;
  }
  const orderedComplaints = [...complaints].sort((a, b) => {
    const ao = isOverdueNoReply(a);
    const bo = isOverdueNoReply(b);
    if (ao !== bo) return ao ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/home" />
        <div className="flex items-center gap-4">
          <Link href="/company/dashboard" className="text-sm text-primary hover:text-highlight">
            Dashboard
          </Link>
          <Link href="/alerts" className="text-sm text-primary hover:text-highlight">
            Alertas
          </Link>
          <Link href="/home" className="text-sm text-primary hover:text-highlight">
            Voltar
          </Link>
        </div>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-5xl mx-auto">
          <h1 className="font-title font-bold text-2xl">Painel da Empresa</h1>
          <div className="text-sm text-foreground/70 mt-1">Reclamações recebidas, respostas e métricas.</div>

          <div className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-3">
            <Link
              href={`/company?status=OPEN&category=${encodeURIComponent(categoryFilter ?? "ALL")}&region=${encodeURIComponent(regionFilter ?? "")}&days=${encodeURIComponent(String(days))}`}
            >
              <Card className="p-4 hover:bg-muted transition-colors">
                <div className="text-xs text-foreground/60">Abertas</div>
                <div className="font-title font-bold text-xl">{openCount}</div>
              </Card>
            </Link>
            <Link
              href={`/company?status=COMPANY_REPLIED&category=${encodeURIComponent(categoryFilter ?? "ALL")}&region=${encodeURIComponent(regionFilter ?? "")}&days=${encodeURIComponent(String(days))}`}
            >
              <Card className="p-4 hover:bg-muted transition-colors">
                <div className="text-xs text-foreground/60">Respondidas</div>
                <div className="font-title font-bold text-xl">{repliedCount}</div>
              </Card>
            </Link>
            <Link
              href={`/company?status=USER_CONTESTED&category=${encodeURIComponent(categoryFilter ?? "ALL")}&region=${encodeURIComponent(regionFilter ?? "")}&days=${encodeURIComponent(String(days))}`}
            >
              <Card className="p-4 hover:bg-muted transition-colors">
                <div className="text-xs text-foreground/60">Contestadas</div>
                <div className="font-title font-bold text-xl">{contestedCount}</div>
              </Card>
            </Link>
            <Link
              href={`/company?status=RESOLVED&category=${encodeURIComponent(categoryFilter ?? "ALL")}&region=${encodeURIComponent(regionFilter ?? "")}&days=${encodeURIComponent(String(days))}`}
            >
              <Card className="p-4 hover:bg-muted transition-colors">
                <div className="text-xs text-foreground/60">Resolvidas</div>
                <div className="font-title font-bold text-xl">{resolvedCount}</div>
              </Card>
            </Link>
            <Link
              href={`/company?status=CLOSED&category=${encodeURIComponent(categoryFilter ?? "ALL")}&region=${encodeURIComponent(regionFilter ?? "")}&days=${encodeURIComponent(String(days))}`}
            >
              <Card className="p-4 hover:bg-muted transition-colors">
                <div className="text-xs text-foreground/60">Encerradas</div>
                <div className="font-title font-bold text-xl">{closedCount}</div>
              </Card>
            </Link>
          </div>

          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-xs text-foreground/60">Taxa de solução</div>
              <div className="font-title font-bold text-xl">{solutionRate}%</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-foreground/60">Tempo médio resposta</div>
              <div className="font-title font-bold text-xl">
                {avgResponseHours !== null ? `${avgResponseHours}h` : "—"}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-foreground/60">Nota SANE+</div>
              <div className="font-title font-bold text-xl">
                {company?.overallScore !== null && company?.overallScore !== undefined ? company.overallScore.toFixed(1) : "—"}
              </div>
            </Card>
          </div>

          <Card className="mt-6 p-4">
            <form className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div>
                <div className="text-xs text-foreground/60 mb-1">Status</div>
                <select
                  name="status"
                  aria-label="Status"
                  defaultValue={statusFilter ?? "ALL"}
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                >
                  <option value="ALL">Todos</option>
                  <option value="OPEN">Abertas (todas)</option>
                  <option value="REGISTERED">Aberta</option>
                  <option value="PUBLISHED">Publicada</option>
                  <option value="USER_CONTESTED">Contestada</option>
                  <option value="COMPANY_REPLIED">Respondida</option>
                  <option value="RESOLVED">Resolvida</option>
                  <option value="CLOSED">Encerrada</option>
                </select>
              </div>
              <div>
                <div className="text-xs text-foreground/60 mb-1">Categoria</div>
                <select
                  name="category"
                  aria-label="Categoria"
                  defaultValue={categoryFilter ?? "ALL"}
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                >
                  <option value="ALL">Todas</option>
                  <option value="WATER">Água</option>
                  <option value="SEWER">Esgoto</option>
                  <option value="INFRASTRUCTURE">Infraestrutura</option>
                  <option value="FINANCIAL">Financeiro</option>
                  <option value="SERVICE">Atendimento</option>
                </select>
              </div>
              <div>
                <div className="text-xs text-foreground/60 mb-1">Região</div>
                <input
                  type="text"
                  name="region"
                  aria-label="Região"
                  defaultValue={regionFilter ?? ""}
                  placeholder="Bairro, rua ou ponto de referência"
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                />
              </div>
              <div>
                <div className="text-xs text-foreground/60 mb-1">Período (dias)</div>
                <input
                  type="number"
                  name="days"
                  aria-label="Período em dias"
                  min={0}
                  max={365}
                  defaultValue={days || ""}
                  placeholder="Ex.: 30"
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                />
              </div>
              <div className="flex items-end">
                <div className="w-full flex gap-2">
                  <button
                    type="submit"
                    className="h-10 flex-1 rounded-xl bg-primary text-white px-4 font-title font-semibold hover:opacity-90"
                  >
                    Filtrar
                  </button>
                  {company ? (
                    <a
                      href={exportUrl}
                      className="h-10 flex-1 rounded-xl bg-secondary text-white px-4 font-title font-semibold flex items-center justify-center hover:opacity-90"
                    >
                      Exportar CSV
                    </a>
                  ) : null}
                  {company ? (
                    <a
                      href={`${exportUrl}&format=xlsx`}
                      className="h-10 flex-1 rounded-xl bg-secondary text-white px-4 font-title font-semibold flex items-center justify-center hover:opacity-90"
                    >
                      Exportar XLSX
                    </a>
                  ) : null}
                </div>
              </div>
            </form>
          </Card>

          {overdueNoReply > 0 ? (
            <Card className="mt-4 p-4 border-[#b54708]">
              <div className="text-sm text-[#b54708]">
                {overdueNoReply} reclamações sem resposta há mais de 24h. Responder rápido melhora a taxa de solução e sua reputação.
              </div>
            </Card>
          ) : null}

          {company ? (
            <Card className="mt-6 p-6">
              <div className="font-title font-bold text-lg">Configurações da empresa</div>
              <div className="text-sm text-foreground/70 mb-4">Atualize nome, cidade/UF e logo. Alterações são registradas.</div>
              <CompanySettingsForm
                companyId={company.id}
                initial={{ name: company.name, city: company.city, state: company.state, logoUrl: company.logoUrl }}
              />
            </Card>
          ) : null}

          <div className="mt-6 grid gap-2">
            {orderedComplaints.map((c) => {
              const overdue = isOverdueNoReply(c);
              const hours = overdue ? Math.floor((now.getTime() - c.createdAt.getTime()) / (60 * 60 * 1000)) : null;
              return (
              <Link key={c.id} href={`/company/complaints/${c.id}`} className="block">
                <Card className="p-5 hover:bg-muted transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-title font-semibold flex flex-wrap items-center gap-2">
                        <span>{c.issue}</span>
                        {overdue ? (
                          <span className="inline-flex items-center rounded-full bg-[#fff4e6] px-2 py-0.5 text-[11px] text-[#b54708]">
                            Atrasada (+24h{hours && hours > 24 ? ` • ${hours}h` : ""})
                          </span>
                        ) : null}
                        {!overdue && c.responses.length === 0 && openStatuses.includes(c.status) ? (
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground/70">
                            Sem resposta
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-foreground/60 mt-1">
                        {(c.user.name ?? c.user.email ?? "Usuário").toString()}
                      </div>
                    </div>
                    <div className="text-right text-xs text-foreground/60">
                      <div>{statusLabel[c.status] ?? c.status}</div>
                      <div>{new Date(c.createdAt).toLocaleDateString("pt-BR")}</div>
                    </div>
                  </div>
                </Card>
              </Link>
              );
            })}

            {!complaints.length ? (
              <Card className="p-5">
                <div className="text-sm text-foreground/70">
                  Nenhuma reclamação recebida no momento.
                </div>
              </Card>
            ) : null}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            {company ? (
              <Link href={`/companies/${company.id}`} className="text-sm text-primary hover:text-highlight">
                Ver perfil público e métricas
              </Link>
            ) : null}
            <Link href="/company/metrics" className="text-sm text-primary hover:text-highlight">
              Ver tendências detalhadas
            </Link>
            <Link href="/profile" className="text-sm text-primary hover:text-highlight">
              Configurações de notificação
            </Link>
          </div>
          {company ? (
            <Card className="mt-6 p-4">
              <div className="font-title font-bold text-lg">Usuários internos</div>
              <form
                className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3"
                action={`/api/companies/${company.id}/users`}
                method="POST"
              >
                <input
                  type="email"
                  name="email"
                  aria-label="E-mail do colaborador"
                  placeholder="E-mail do colaborador"
                  required
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                />
                <button
                  type="submit"
                  className="h-10 rounded-xl bg-primary text-white px-4 font-title font-semibold hover:opacity-90"
                >
                  Adicionar
                </button>
              </form>
              <div className="text-xs text-foreground/60 mt-2">
                O colaborador precisa ter uma conta no SANE+ com este e-mail.
              </div>
              <div className="mt-4 grid gap-2">
                {companyUsers.map((u) => (
                  <div key={u.id} className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm">
                    <div className="font-title font-semibold">{u.name ?? u.email ?? "Usuário"}</div>
                    <div className="text-xs text-foreground/60">
                      {u.email} • desde {new Date(u.createdAt).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                ))}
                {!companyUsers.length ? (
                  <div className="text-sm text-foreground/70">Nenhum usuário interno ainda.</div>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      </main>

    </div>
  );
}
