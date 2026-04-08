import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { AutomationTrigger, ReportScope, ReportType, UserRole } from "@/generated/prisma/client";
import { buildReport } from "@/lib/analytics";
import { applyAutomationRules } from "@/lib/automationRules";
import {
  publishIntegrationEvent,
  publishIntegrationEventToCityScope,
  publishOfficialEmail,
  publishOfficialEmailToCityScope,
} from "@/lib/integrations";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

function truthy(v: unknown) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "y" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n" || s === "off") return false;
  return null;
}

function appUrlFromEnv() {
  const raw = (process.env.APP_URL ?? "").trim();
  return (raw || "http://localhost:3000").replace(/\/$/, "");
}

async function distributeReportSnapshot(args: {
  reportId: string;
  type: ReportType;
  scope: ReportScope;
  period: string;
  city?: string | null;
  state?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  distribute: boolean;
}) {
  if (!args.distribute) return;

  const appUrl = appUrlFromEnv();
  const jsonUrl = `${appUrl}/api/reports/${encodeURIComponent(args.reportId)}`;
  const xlsxSummaryUrl = `${appUrl}/api/reports/${encodeURIComponent(args.reportId)}/export?format=xlsx&table=summary`;
  const xlsxCategoriesUrl = `${appUrl}/api/reports/${encodeURIComponent(args.reportId)}/export?format=xlsx&table=categories`;
  const csvSummaryUrl = `${appUrl}/api/reports/${encodeURIComponent(args.reportId)}/export?format=csv&table=summary`;
  const csvCategoriesUrl = `${appUrl}/api/reports/${encodeURIComponent(args.reportId)}/export?format=csv&table=categories`;

  const payload = {
    reportId: args.reportId,
    type: args.type,
    scope: args.scope,
    period: args.period,
    city: args.city ?? null,
    state: args.state ?? null,
    companyId: args.companyId ?? null,
    downloads: {
      json: jsonUrl,
      xlsx: { summary: xlsxSummaryUrl, categories: xlsxCategoriesUrl },
      csv: { summary: csvSummaryUrl, categories: csvCategoriesUrl },
    },
  };

  const subject = (() => {
    if (args.type === ReportType.CITY_MONTHLY) return `Relatório mensal SANE+ — ${args.city ?? ""}/${args.state ?? ""} — ${args.period}`.trim();
    if (args.type === ReportType.COMPANY_MONTHLY) {
      const name = args.companyName?.trim() || args.companyId || "";
      return `Relatório mensal SANE+ — ${name} — ${args.period}`.trim();
    }
    if (args.type === ReportType.REGIONAL_QUARTERLY) return `Relatório trimestral SANE+ — ${args.state ?? ""} — ${args.period}`.trim();
    if (args.type === ReportType.NATIONAL_ANNUAL) return `Relatório anual SANE+ — ${args.period}`.trim();
    return `Relatório SANE+ — ${args.period}`.trim();
  })();

  const body = [
    "Olá,",
    "",
    `Um relatório institucional do SANE+ foi gerado (${args.type}).`,
    "",
    `Período: ${args.period}`,
    args.city && args.state ? `Cidade: ${args.city}/${args.state}` : null,
    args.state && !args.city ? `UF: ${args.state}` : null,
    args.companyId ? `Empresa: ${args.companyName?.trim() || args.companyId}` : null,
    "",
    "Downloads:",
    `- JSON: ${jsonUrl}`,
    `- XLSX (Resumo): ${xlsxSummaryUrl}`,
    `- XLSX (Categorias): ${xlsxCategoriesUrl}`,
    `- CSV (Resumo): ${csvSummaryUrl}`,
    `- CSV (Categorias): ${csvCategoriesUrl}`,
    "",
    "Obs.: relatórios não públicos exigem autenticação e respeitam o escopo (empresa/cidade/equipe).",
  ]
    .filter(Boolean)
    .join("\n");

  if (args.type === ReportType.COMPANY_MONTHLY) {
    if (!args.companyId) return;
    await publishIntegrationEvent({
      prisma,
      companyId: args.companyId,
      city: args.city ?? null,
      state: args.state ?? null,
      eventType: "report.generated",
      payload,
    });
    await publishOfficialEmail({
      prisma,
      companyId: args.companyId,
      city: args.city ?? null,
      state: args.state ?? null,
      subject,
      body,
      meta: { reportId: args.reportId, type: args.type, scope: args.scope, period: args.period },
    });
    return;
  }

  if (args.type === ReportType.CITY_MONTHLY) {
    await publishIntegrationEventToCityScope({
      prisma,
      city: args.city ?? null,
      state: args.state ?? null,
      eventType: "report.generated",
      payload,
    });
    await publishOfficialEmailToCityScope({
      prisma,
      city: args.city ?? null,
      state: args.state ?? null,
      subject,
      body,
      meta: { reportId: args.reportId, type: args.type, scope: args.scope, period: args.period },
    });
    return;
  }

  if (args.type === ReportType.REGIONAL_QUARTERLY) {
    await publishIntegrationEventToCityScope({
      prisma,
      state: args.state ?? null,
      eventType: "report.generated",
      payload,
    });
    await publishOfficialEmailToCityScope({
      prisma,
      state: args.state ?? null,
      subject,
      body,
      meta: { reportId: args.reportId, type: args.type, scope: args.scope, period: args.period },
    });
    return;
  }

  if (args.type === ReportType.NATIONAL_ANNUAL) {
    await publishIntegrationEventToCityScope({ prisma, eventType: "report.generated", payload });
    await publishOfficialEmailToCityScope({
      prisma,
      subject,
      body,
      meta: { reportId: args.reportId, type: args.type, scope: args.scope, period: args.period },
    });
  }
}

function toInt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function readBody(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return (await req.json()) as unknown;
    } catch {
      return null;
    }
  }
  try {
    const form = await req.formData();
    const obj: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) obj[k] = typeof v === "string" ? v : String(v);
    return obj;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `reports:generate:${user.id}:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const body = await readBody(req);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const typeRaw = (body as Record<string, unknown>)["type"];
  const publishRaw = (body as Record<string, unknown>)["publish"];
  const publish = publishRaw === true || publishRaw === "1" || publishRaw === "true";
  const distributeRaw = (body as Record<string, unknown>)["distribute"];
  const distribute = truthy(distributeRaw) ?? false;

  if (typeRaw === ReportType.INSTITUTIONAL_MONTHLY || typeRaw === "INSTITUTIONAL_MONTHLY") {
    const city = String((body as Record<string, unknown>)["city"] ?? "").trim();
    const state = String((body as Record<string, unknown>)["state"] ?? "").trim();
    const period = String((body as Record<string, unknown>)["period"] ?? "").trim();
    if (!city || !state || !period) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

    const report = await buildReport(prisma, { type: ReportType.INSTITUTIONAL_MONTHLY, city, state, period });
    if (!report) return NextResponse.json({ error: "invalid_period" }, { status: 400 });

    const scope = publish ? ReportScope.PUBLIC : ReportScope.CITY;
    const snapshot = await prisma.reportSnapshot.create({
      data: { type: ReportType.INSTITUTIONAL_MONTHLY, scope, period: report.period, payload: report.payload, city, state },
      select: { id: true, type: true, scope: true, period: true, generatedAt: true },
    });
    await distributeReportSnapshot({
      reportId: snapshot.id,
      type: snapshot.type,
      scope: snapshot.scope,
      period: snapshot.period,
      city,
      state,
      distribute,
    });
    try {
      await applyAutomationRules(prisma, {
        trigger: AutomationTrigger.REPORT_GENERATED,
        actor: { id: user.id, role: user.role },
        context: { reportId: snapshot.id, type: snapshot.type, scope: snapshot.scope, period: snapshot.period, city, state },
      });
    } catch (err) {
      void err;
    }
    return NextResponse.json(snapshot);
  }

  if (typeRaw === ReportType.COMPANY_MONTHLY || typeRaw === "COMPANY_MONTHLY") {
    const companyId = String((body as Record<string, unknown>)["companyId"] ?? "").trim();
    const period = String((body as Record<string, unknown>)["period"] ?? "").trim();
    if (!companyId || !period) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

    const report = await buildReport(prisma, { type: ReportType.COMPANY_MONTHLY, companyId, period });
    if (!report) return NextResponse.json({ error: "invalid_period" }, { status: 400 });

    const scope = ReportScope.COMPANY;
    const snapshot = await prisma.reportSnapshot.create({
      data: { type: ReportType.COMPANY_MONTHLY, scope, period: report.period, payload: report.payload, companyId },
      select: { id: true, type: true, scope: true, period: true, generatedAt: true },
    });
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, city: true, state: true },
    });
    await distributeReportSnapshot({
      reportId: snapshot.id,
      type: snapshot.type,
      scope: snapshot.scope,
      period: snapshot.period,
      companyId,
      companyName: company?.name ?? null,
      city: company?.city ?? null,
      state: company?.state ?? null,
      distribute,
    });
    try {
      await applyAutomationRules(prisma, {
        trigger: AutomationTrigger.REPORT_GENERATED,
        actor: { id: user.id, role: user.role },
        context: { reportId: snapshot.id, type: snapshot.type, scope: snapshot.scope, period: snapshot.period, companyId },
      });
    } catch (err) {
      void err;
    }
    return NextResponse.json(snapshot);
  }

  if (typeRaw === ReportType.CITY_MONTHLY || typeRaw === "CITY_MONTHLY") {
    const city = String((body as Record<string, unknown>)["city"] ?? "").trim();
    const state = String((body as Record<string, unknown>)["state"] ?? "").trim();
    const period = String((body as Record<string, unknown>)["period"] ?? "").trim();
    if (!city || !state || !period) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

    const report = await buildReport(prisma, { type: ReportType.CITY_MONTHLY, city, state, period });
    if (!report) return NextResponse.json({ error: "invalid_period" }, { status: 400 });

    const scope = publish ? ReportScope.PUBLIC : ReportScope.CITY;
    const snapshot = await prisma.reportSnapshot.create({
      data: { type: ReportType.CITY_MONTHLY, scope, period: report.period, payload: report.payload, city, state },
      select: { id: true, type: true, scope: true, period: true, generatedAt: true },
    });
    await distributeReportSnapshot({
      reportId: snapshot.id,
      type: snapshot.type,
      scope: snapshot.scope,
      period: snapshot.period,
      city,
      state,
      distribute,
    });
    try {
      await applyAutomationRules(prisma, {
        trigger: AutomationTrigger.REPORT_GENERATED,
        actor: { id: user.id, role: user.role },
        context: { reportId: snapshot.id, type: snapshot.type, scope: snapshot.scope, period: snapshot.period, city, state },
      });
    } catch (err) {
      void err;
    }
    return NextResponse.json(snapshot);
  }

  if (typeRaw === ReportType.INSTITUTIONAL_QUARTERLY || typeRaw === "INSTITUTIONAL_QUARTERLY") {
    const state = String((body as Record<string, unknown>)["state"] ?? "").trim();
    const year = toInt((body as Record<string, unknown>)["year"]);
    const quarter = toInt((body as Record<string, unknown>)["quarter"]);
    if (!state || !year || !quarter) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

    const report = await buildReport(prisma, { type: ReportType.INSTITUTIONAL_QUARTERLY, state, year, quarter });
    if (!report) return NextResponse.json({ error: "invalid_period" }, { status: 400 });

    const scope = publish ? ReportScope.PUBLIC : ReportScope.REGION;
    const snapshot = await prisma.reportSnapshot.create({
      data: { type: ReportType.INSTITUTIONAL_QUARTERLY, scope, period: report.period, payload: report.payload, state },
      select: { id: true, type: true, scope: true, period: true, generatedAt: true },
    });
    await distributeReportSnapshot({
      reportId: snapshot.id,
      type: snapshot.type,
      scope: snapshot.scope,
      period: snapshot.period,
      state,
      distribute,
    });
    try {
      await applyAutomationRules(prisma, {
        trigger: AutomationTrigger.REPORT_GENERATED,
        actor: { id: user.id, role: user.role },
        context: { reportId: snapshot.id, type: snapshot.type, scope: snapshot.scope, period: snapshot.period, state },
      });
    } catch (err) {
      void err;
    }
    return NextResponse.json(snapshot);
  }

  if (typeRaw === ReportType.REGIONAL_QUARTERLY || typeRaw === "REGIONAL_QUARTERLY") {
    const state = String((body as Record<string, unknown>)["state"] ?? "").trim();
    const year = toInt((body as Record<string, unknown>)["year"]);
    const quarter = toInt((body as Record<string, unknown>)["quarter"]);
    if (!state || !year || !quarter) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

    const report = await buildReport(prisma, { type: ReportType.REGIONAL_QUARTERLY, state, year, quarter });
    if (!report) return NextResponse.json({ error: "invalid_period" }, { status: 400 });

    const scope = publish ? ReportScope.PUBLIC : ReportScope.REGION;
    const snapshot = await prisma.reportSnapshot.create({
      data: { type: ReportType.REGIONAL_QUARTERLY, scope, period: report.period, payload: report.payload, state },
      select: { id: true, type: true, scope: true, period: true, generatedAt: true },
    });
    await distributeReportSnapshot({
      reportId: snapshot.id,
      type: snapshot.type,
      scope: snapshot.scope,
      period: snapshot.period,
      state,
      distribute,
    });
    try {
      await applyAutomationRules(prisma, {
        trigger: AutomationTrigger.REPORT_GENERATED,
        actor: { id: user.id, role: user.role },
        context: { reportId: snapshot.id, type: snapshot.type, scope: snapshot.scope, period: snapshot.period, state },
      });
    } catch (err) {
      void err;
    }
    return NextResponse.json(snapshot);
  }

  if (typeRaw === ReportType.INSTITUTIONAL_ANNUAL || typeRaw === "INSTITUTIONAL_ANNUAL") {
    const year = toInt((body as Record<string, unknown>)["year"]);
    if (!year) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

    const report = await buildReport(prisma, { type: ReportType.INSTITUTIONAL_ANNUAL, year });
    if (!report) return NextResponse.json({ error: "invalid_period" }, { status: 400 });

    const scope = publish ? ReportScope.PUBLIC : ReportScope.NATIONAL;
    const snapshot = await prisma.reportSnapshot.create({
      data: { type: ReportType.INSTITUTIONAL_ANNUAL, scope, period: report.period, payload: report.payload },
      select: { id: true, type: true, scope: true, period: true, generatedAt: true },
    });
    await distributeReportSnapshot({
      reportId: snapshot.id,
      type: snapshot.type,
      scope: snapshot.scope,
      period: snapshot.period,
      distribute,
    });
    try {
      await applyAutomationRules(prisma, {
        trigger: AutomationTrigger.REPORT_GENERATED,
        actor: { id: user.id, role: user.role },
        context: { reportId: snapshot.id, type: snapshot.type, scope: snapshot.scope, period: snapshot.period },
      });
    } catch (err) {
      void err;
    }
    return NextResponse.json(snapshot);
  }

  if (typeRaw === ReportType.NATIONAL_ANNUAL || typeRaw === "NATIONAL_ANNUAL") {
    const year = toInt((body as Record<string, unknown>)["year"]);
    if (!year) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

    const report = await buildReport(prisma, { type: ReportType.NATIONAL_ANNUAL, year });
    if (!report) return NextResponse.json({ error: "invalid_period" }, { status: 400 });

    const scope = publish ? ReportScope.PUBLIC : ReportScope.NATIONAL;
    const snapshot = await prisma.reportSnapshot.create({
      data: { type: ReportType.NATIONAL_ANNUAL, scope, period: report.period, payload: report.payload },
      select: { id: true, type: true, scope: true, period: true, generatedAt: true },
    });
    await distributeReportSnapshot({
      reportId: snapshot.id,
      type: snapshot.type,
      scope: snapshot.scope,
      period: snapshot.period,
      distribute,
    });
    try {
      await applyAutomationRules(prisma, {
        trigger: AutomationTrigger.REPORT_GENERATED,
        actor: { id: user.id, role: user.role },
        context: { reportId: snapshot.id, type: snapshot.type, scope: snapshot.scope, period: snapshot.period },
      });
    } catch (err) {
      void err;
    }
    return NextResponse.json(snapshot);
  }

  return NextResponse.json({ error: "invalid_type" }, { status: 400 });
}
