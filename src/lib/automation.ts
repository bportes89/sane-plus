import type { PrismaClient } from "@/generated/prisma/client";
import {
  AutomationTrigger,
  ComplaintCategory,
  ComplaintEventType,
  ComplaintStatus,
  DataAlertScope,
  DataAlertType,
  NotificationType,
  UserRole,
} from "@/generated/prisma/client";
import { queueEmail } from "@/lib/outbox";
import { applyAutomationRules } from "@/lib/automationRules";

type Urgency = "low" | "medium" | "high" | "critical";

function normalizeText(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreKeywords(text: string, keywords: string[]) {
  let score = 0;
  for (const k of keywords) {
    if (!k) continue;
    if (text.includes(k)) score += 1;
  }
  return score;
}

function classifySubcategory(args: {
  category: ComplaintCategory;
  issue: string;
  description: string;
}): string | null {
  const text = normalizeText(`${args.issue} ${args.description}`);

  if (args.category === ComplaintCategory.WATER) {
    const candidates: Array<{ label: string; keys: string[] }> = [
      { label: "Falta de água", keys: ["sem agua", "falta de agua", "interromp", "acabou a agua"] },
      { label: "Baixa pressão", keys: ["baixa pressao", "pressao baixa", "pouca pressao"] },
      { label: "Água turva", keys: ["agua turva", "agua suja", "barrenta", "esbranqui"] },
      { label: "Água com odor", keys: ["mau cheiro", "odor", "cheiro estranho"] },
      { label: "Água com gosto estranho", keys: ["gosto estranho", "gosto ruim", "salobra"] },
    ];
    let best: { label: string; score: number } | null = null;
    for (const c of candidates) {
      const s = scoreKeywords(text, c.keys);
      if (s <= 0) continue;
      if (!best || s > best.score) best = { label: c.label, score: s };
    }
    return best?.label ?? null;
  }

  if (args.category === ComplaintCategory.SEWER) {
    const candidates: Array<{ label: string; keys: string[] }> = [
      { label: "Esgoto a céu aberto", keys: ["ceu aberto", "a ceu aberto", "esgoto na rua", "valao"] },
      { label: "Retorno de esgoto", keys: ["retorno de esgoto", "voltou esgoto", "refluxo", "retornou"] },
      { label: "Vazamento de esgoto", keys: ["vazamento", "esgoto vazando", "escorrendo esgoto"] },
      { label: "Mau cheiro", keys: ["mau cheiro", "fedor", "cheiro forte"] },
    ];
    let best: { label: string; score: number } | null = null;
    for (const c of candidates) {
      const s = scoreKeywords(text, c.keys);
      if (s <= 0) continue;
      if (!best || s > best.score) best = { label: c.label, score: s };
    }
    return best?.label ?? null;
  }

  if (args.category === ComplaintCategory.INFRASTRUCTURE) {
    const candidates: Array<{ label: string; keys: string[] }> = [
      { label: "Vazamento na rua", keys: ["vazamento na rua", "na rua", "asfalto", "calcada", "via"] },
      { label: "Vazamento interno", keys: ["dentro", "na casa", "interno", "no quintal"] },
      { label: "Tubulação danificada", keys: ["tubulacao", "cano", "tubo", "quebrado", "estourado"] },
      { label: "Boca de lobo entupida", keys: ["boca de lobo", "bueiro", "entupido", "entupida"] },
    ];
    let best: { label: string; score: number } | null = null;
    for (const c of candidates) {
      const s = scoreKeywords(text, c.keys);
      if (s <= 0) continue;
      if (!best || s > best.score) best = { label: c.label, score: s };
    }
    return best?.label ?? null;
  }

  if (args.category === ComplaintCategory.FINANCIAL) {
    const candidates: Array<{ label: string; keys: string[] }> = [
      { label: "Conta alta", keys: ["conta alta", "valor alto", "cobrou muito", "absurdo"] },
      { label: "Cobrança indevida", keys: ["cobranca indevida", "indevida", "cobraram", "duplicada"] },
      { label: "Falha na leitura do hidrômetro", keys: ["hidrometro", "leitura", "relogio", "medidor"] },
    ];
    let best: { label: string; score: number } | null = null;
    for (const c of candidates) {
      const s = scoreKeywords(text, c.keys);
      if (s <= 0) continue;
      if (!best || s > best.score) best = { label: c.label, score: s };
    }
    return best?.label ?? null;
  }

  const candidates: Array<{ label: string; keys: string[] }> = [
    { label: "Demora", keys: ["demora", "sem retorno", "nao respond", "dias esperando"] },
    { label: "Atendimento inadequado", keys: ["mal atendimento", "grosseiro", "grosso", "inadequado"] },
    { label: "Protocolo não cumprido", keys: ["protocolo", "nao cumpr", "prometeram"] },
  ];
  let best: { label: string; score: number } | null = null;
  for (const c of candidates) {
    const s = scoreKeywords(text, c.keys);
    if (s <= 0) continue;
    if (!best || s > best.score) best = { label: c.label, score: s };
  }
  return best?.label ?? null;
}

function classifyUrgency(args: {
  category: ComplaintCategory;
  issue: string;
  description: string;
  subcategory: string | null;
}): { urgency: Urgency; flags: { environmentalRisk: boolean; healthRisk: boolean } } {
  const text = normalizeText(`${args.issue} ${args.description}`);
  const healthRisk =
    scoreKeywords(text, ["hospital", "crianca", "crianca", "intoxic", "diarreia", "doenca", "contamin"]) > 0;
  const environmentalRisk =
    args.category === ComplaintCategory.SEWER ||
    args.category === ComplaintCategory.INFRASTRUCTURE ||
    scoreKeywords(text, ["esgoto", "ceu aberto", "contamin", "vazamento"]) > 0;

  if (healthRisk && scoreKeywords(text, ["contamin", "intoxic", "hospital"]) > 0) {
    return { urgency: "critical", flags: { environmentalRisk, healthRisk } };
  }
  if (environmentalRisk && scoreKeywords(text, ["ceu aberto", "vazamento", "muito", "forte", "grande"]) > 0) {
    return { urgency: "high", flags: { environmentalRisk, healthRisk } };
  }
  if (args.subcategory && normalizeText(args.subcategory).includes("vazamento")) {
    return { urgency: "high", flags: { environmentalRisk, healthRisk } };
  }
  return { urgency: "medium", flags: { environmentalRisk, healthRisk } };
}

async function getSystemConfigInt(prisma: PrismaClient, key: string, fallback: number) {
  const row = await prisma.systemConfig.findUnique({ where: { key }, select: { value: true } });
  if (!row) return fallback;
  const v = Number.parseInt(row.value, 10);
  return Number.isFinite(v) ? v : fallback;
}

function prefeituraKey(city: string | null | undefined, state: string | null | undefined) {
  const c = city?.trim() ?? "";
  const s = state?.trim() ?? "";
  if (!c || !s) return null;
  return `prefeitura_emails:${c.toLowerCase()}:${s.toLowerCase()}`;
}

function parseEmailList(raw: string | null | undefined) {
  if (!raw) return [];
  return raw
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter((x) => x.includes("@"))
    .slice(0, 10);
}

export async function runComplaintCreatedAutomations(
  prisma: PrismaClient,
  args: { complaintId: string },
) {
  const complaint = await prisma.complaint.findUnique({
    where: { id: args.complaintId },
    select: {
      id: true,
      userId: true,
      companyId: true,
      category: true,
      issue: true,
      description: true,
      subcategory: true,
      status: true,
      visibility: true,
      neighborhood: true,
      createdAt: true,
      company: { select: { id: true, name: true, city: true, state: true } },
    },
  });
  if (!complaint) return;

  const inferredSubcategory = complaint.subcategory ?? classifySubcategory(complaint);
  const urgencyInfo = classifyUrgency({
    category: complaint.category,
    issue: complaint.issue,
    description: complaint.description,
    subcategory: inferredSubcategory,
  });

  const duplicateWindowDays = await getSystemConfigInt(prisma, "automation_duplicate_window_days", 7);
  const duplicateWindowFrom = new Date(Date.now() - duplicateWindowDays * 24 * 60 * 60 * 1000);
  const normalizedIssue = normalizeText(complaint.issue);
  const normalizedDesc = normalizeText(complaint.description).slice(0, 240);

  const recentByUser = await prisma.complaint.findMany({
    where: {
      userId: complaint.userId,
      companyId: complaint.companyId,
      createdAt: { gte: duplicateWindowFrom },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, issue: true, description: true, createdAt: true },
  });

  const duplicates = recentByUser.filter((c) => {
    if (c.id === complaint.id) return false;
    const ni = normalizeText(c.issue);
    const nd = normalizeText(c.description).slice(0, 240);
    if (ni && normalizedIssue && ni === normalizedIssue) return true;
    if (nd && normalizedDesc && nd === normalizedDesc) return true;
    return false;
  });

  const suspiciousWindowMinutes = await getSystemConfigInt(prisma, "automation_suspicious_burst_window_minutes", 20);
  const suspiciousMax = await getSystemConfigInt(prisma, "automation_suspicious_burst_max", 6);
  const suspiciousFrom = new Date(Date.now() - suspiciousWindowMinutes * 60 * 1000);
  const recentBurstCount = await prisma.complaint.count({
    where: { userId: complaint.userId, createdAt: { gte: suspiciousFrom } },
  });

  const companyUsers = await prisma.user.findMany({
    where: { role: UserRole.COMPANY, companyId: complaint.companyId, notifyInApp: true },
    select: { id: true },
  });

  const staffUsers = await prisma.user.findMany({
    where: { role: { in: [UserRole.ADMIN, UserRole.MODERATOR, UserRole.LEGAL] }, notifyInApp: true },
    select: { id: true },
  });

  const shouldNotifyCompany = complaint.status !== ComplaintStatus.NEEDS_REVIEW;
  const shouldEscalate = urgencyInfo.urgency === "high" || urgencyInfo.urgency === "critical" || complaint.status === ComplaintStatus.NEEDS_REVIEW;
  const shouldPrefeitura = urgencyInfo.flags.environmentalRisk || urgencyInfo.flags.healthRisk;
  const shouldAlertSuspicious = recentBurstCount > suspiciousMax;

  await prisma.$transaction(async (tx) => {
    if (!complaint.subcategory && inferredSubcategory) {
      await tx.complaint.update({
        where: { id: complaint.id },
        data: { subcategory: inferredSubcategory },
      });
      await tx.complaintEvent.create({
        data: {
          complaintId: complaint.id,
          type: ComplaintEventType.CONTENT_ADJUSTED,
          message: "Classificação automática aplicada para agilizar o atendimento.",
        },
      });
    }

    if (shouldNotifyCompany && companyUsers.length) {
      await tx.notification.createMany({
        data: companyUsers.map((u) => ({
          userId: u.id,
          type: NotificationType.ALERT,
          title: "Nova reclamação",
          message: `Nova reclamação recebida: ${complaint.issue}`.slice(0, 900),
          actionUrl: `/company/complaints/${complaint.id}`,
        })),
      });
    }

    if (duplicates.length >= 2) {
      const citizen = await tx.user.findUnique({
        where: { id: complaint.userId },
        select: { notifyInApp: true },
      });
      if (!citizen || citizen.notifyInApp) {
        await tx.notification.create({
          data: {
            userId: complaint.userId,
            type: NotificationType.ALERT,
            title: "Você tem reclamações parecidas",
            message: "Detectamos reclamações muito parecidas. Considere agrupar ou atualizar uma única reclamação para facilitar o acompanhamento.",
            actionUrl: `/complaints`,
          },
        });
      }
      const fingerprint = `complaint:${complaint.id}:duplicates:${duplicateWindowDays}d`;
      await tx.dataAlert.upsert({
        where: { fingerprint },
        create: {
          scope: DataAlertScope.INTERNAL,
          type: DataAlertType.RECURRING,
          fingerprint,
          companyId: complaint.companyId,
          title: "Possível duplicidade",
          message: "Detectamos reclamações muito parecidas do mesmo usuário para a mesma empresa.",
          severity: "low",
          meta: { complaintId: complaint.id, duplicates: duplicates.map((d) => d.id) },
        },
        update: {},
      });
    }

    if (shouldEscalate && staffUsers.length) {
      await tx.notification.createMany({
        data: staffUsers.map((u) => ({
          userId: u.id,
          type: NotificationType.ALERT,
          title: "Atenção: caso prioritário",
          message: `Reclamação exige atenção: ${complaint.issue}`.slice(0, 900),
          actionUrl: `/complaints/${complaint.id}`,
        })),
      });
    }

    if (shouldAlertSuspicious) {
      const fingerprint = `user:${complaint.userId}:burst:${suspiciousWindowMinutes}m:${new Date().toISOString().slice(0, 10)}`;
      await tx.dataAlert.upsert({
        where: { fingerprint },
        create: {
          scope: DataAlertScope.INTERNAL,
          type: DataAlertType.RECURRING,
          fingerprint,
          companyId: complaint.companyId,
          title: "Padrão suspeito: muitas reclamações em pouco tempo",
          message: `Usuário registrou ${recentBurstCount} reclamações nos últimos ${suspiciousWindowMinutes} min.`,
          severity: "medium",
          meta: { userId: complaint.userId, count: recentBurstCount, windowMinutes: suspiciousWindowMinutes, complaintId: complaint.id },
        },
        update: {},
      });
      if (staffUsers.length) {
        await tx.notification.createMany({
          data: staffUsers.map((u) => ({
            userId: u.id,
            type: NotificationType.ALERT,
            title: "Padrão suspeito detectado",
            message: "Detectamos muitas reclamações em pouco tempo. Revisar possível abuso/spam.",
            actionUrl: "/alerts",
          })),
        });
      }
    }

    if (shouldPrefeitura && complaint.company.city && complaint.company.state) {
      const fingerprint = `complaint:${complaint.id}:prefeitura:${complaint.company.city}:${complaint.company.state}`;
      await tx.dataAlert.upsert({
        where: { fingerprint },
        create: {
          scope: DataAlertScope.CITY,
          type: urgencyInfo.flags.healthRisk ? DataAlertType.CONTAMINATION : DataAlertType.RECURRING,
          fingerprint,
          companyId: complaint.companyId,
          city: complaint.company.city,
          state: complaint.company.state,
          title: "Sinal de risco para prefeitura",
          message: "Há indício de risco ambiental/saúde associado a uma reclamação recente.",
          severity: urgencyInfo.urgency === "critical" ? "high" : "medium",
          meta: {
            complaintId: complaint.id,
            urgency: urgencyInfo.urgency,
            category: complaint.category,
            subcategory: inferredSubcategory,
          },
        },
        update: {},
      });
    }
  });

  if (shouldPrefeitura && complaint.company.city && complaint.company.state) {
    const key = prefeituraKey(complaint.company.city, complaint.company.state);
    if (key) {
      const cfg = await prisma.systemConfig.findUnique({ where: { key }, select: { value: true } });
      const emails = parseEmailList(cfg?.value);
      for (const to of emails) {
        await queueEmail({
          to,
          subject: "SANE+ • Alerta automático (risco ambiental/saúde)",
          body:
            "Alerta automático do SANE+.\n\n" +
            `Cidade: ${complaint.company.city}/${complaint.company.state}\n` +
            `Empresa: ${complaint.company.name}\n` +
            `Reclamação: ${complaint.issue}\n` +
            `Urgência (heurística): ${urgencyInfo.urgency}\n\n` +
            `Link: ${process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}/complaints/${complaint.id}` : `/complaints/${complaint.id}`}\n`,
          complaintId: complaint.id,
          meta: { type: "prefeitura_alert", urgency: urgencyInfo.urgency, key },
        });
      }
    }
  }

  try {
    await applyAutomationRules(prisma, {
      trigger: AutomationTrigger.COMPLAINT_CREATED,
      actor: null,
      context: {
        complaintId: complaint.id,
        userId: complaint.userId,
        companyId: complaint.companyId,
        category: complaint.category,
        subcategory: inferredSubcategory,
        urgency: urgencyInfo.urgency,
        flags: urgencyInfo.flags,
        issue: complaint.issue,
        description: complaint.description,
        city: complaint.company.city,
        state: complaint.company.state,
      },
    });
  } catch (err) {
    void err;
  }
}

export async function runCompanyResponseAutomations(
  prisma: PrismaClient,
  args: { complaintId: string; responseId: string; responseStatus: "VISIBLE" | "UNDER_REVIEW" | "HIDDEN" },
) {
  const complaint = await prisma.complaint.findUnique({
    where: { id: args.complaintId },
    select: { id: true, userId: true, companyId: true },
  });
  if (!complaint) return;

  try {
    await applyAutomationRules(prisma, {
      trigger: AutomationTrigger.COMPANY_REPLIED,
      actor: null,
      context: {
        complaintId: complaint.id,
        userId: complaint.userId,
        companyId: complaint.companyId,
        responseId: args.responseId,
        responseStatus: args.responseStatus,
      },
    });
  } catch (err) {
    void err;
  }

  if (args.responseStatus !== "UNDER_REVIEW") return;
  const staff = await prisma.user.findMany({
    where: { role: { in: [UserRole.ADMIN, UserRole.MODERATOR, UserRole.LEGAL] }, notifyInApp: true },
    select: { id: true },
  });
  if (!staff.length) return;

  const fingerprint = `response:${args.responseId}:under_review`;
  await prisma.$transaction(async (tx) => {
    await tx.dataAlert.upsert({
      where: { fingerprint },
      create: {
        scope: DataAlertScope.INTERNAL,
        type: DataAlertType.RECURRING,
        fingerprint,
        title: "Resposta de empresa em análise",
        message: "Uma resposta de empresa foi retida para moderação automática.",
        severity: "medium",
        meta: { complaintId: args.complaintId, responseId: args.responseId },
      },
      update: {},
    });
    await tx.notification.createMany({
      data: staff.map((u) => ({
        userId: u.id,
        type: NotificationType.ALERT,
        title: "Resposta em análise",
        message: "Uma resposta de empresa foi retida para revisão.",
        actionUrl: `/complaints/${args.complaintId}`,
      })),
    });
  });
}

export async function runComplaintResolvedAutomations(
  prisma: PrismaClient,
  args: { complaintId: string },
) {
  const complaint = await prisma.complaint.findUnique({
    where: { id: args.complaintId },
    select: { id: true, issue: true, companyId: true },
  });
  if (!complaint) return;
  const recipients = await prisma.user.findMany({
    where: { role: UserRole.COMPANY, companyId: complaint.companyId, notifyInApp: true },
    select: { id: true },
  });
  if (!recipients.length) return;
  await prisma.notification.createMany({
    data: recipients.map((u) => ({
      userId: u.id,
      type: NotificationType.ALERT,
      title: "Reclamação marcada como resolvida",
      message: `O usuário marcou como resolvida: ${complaint.issue}`.slice(0, 900),
      actionUrl: `/company/complaints/${complaint.id}`,
    })),
  });

  try {
    await applyAutomationRules(prisma, {
      trigger: AutomationTrigger.COMPLAINT_RESOLVED,
      actor: null,
      context: {
        complaintId: complaint.id,
        companyId: complaint.companyId,
        issue: complaint.issue,
      },
    });
  } catch (err) {
    void err;
  }
}
