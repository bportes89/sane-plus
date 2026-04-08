import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { DistributionFrequency, JobRunStatus, ReportScope, ReportType } from "@/generated/prisma/client";
import { buildReport } from "@/lib/analytics";
import { queueEmail } from "@/lib/outbox";
import { queueWebhook } from "@/lib/webhooks";

function isCronRequest(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const provided = req.headers.get("x-cron-secret");
  if (provided && provided === cronSecret) return true;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  return !!token && token === cronSecret;
}

function appUrlFromEnv() {
  const raw = (process.env.APP_URL ?? "").trim();
  return (raw || "http://localhost:3000").replace(/\/$/, "");
}

function prevMonth(now: Date) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = new Date(Date.UTC(y, m, 1));
  d.setUTCDate(0);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function prevQuarter(now: Date) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const q = Math.ceil(m / 3);
  const prevQ = q === 1 ? 4 : (q - 1);
  const year = q === 1 ? y - 1 : y;
  return `${year}-Q${prevQ}`;
}

function prevYear(now: Date) {
  return String(now.getUTCFullYear() - 1);
}

function computeTargetPeriod(t: ReportType, now: Date) {
  if (t === ReportType.CITY_MONTHLY || t === ReportType.COMPANY_MONTHLY || t === ReportType.INSTITUTIONAL_MONTHLY) {
    return prevMonth(now);
  }
  if (t === ReportType.REGIONAL_QUARTERLY || t === ReportType.INSTITUTIONAL_QUARTERLY) {
    return prevQuarter(now);
  }
  if (t === ReportType.NATIONAL_ANNUAL || t === ReportType.INSTITUTIONAL_ANNUAL) {
    return prevYear(now);
  }
  return null;
}

function reportFrequency(t: ReportType): DistributionFrequency {
  if (t === ReportType.CITY_MONTHLY || t === ReportType.COMPANY_MONTHLY || t === ReportType.INSTITUTIONAL_MONTHLY) {
    return DistributionFrequency.MONTHLY;
  }
  if (t === ReportType.REGIONAL_QUARTERLY || t === ReportType.INSTITUTIONAL_QUARTERLY) {
    return DistributionFrequency.QUARTERLY;
  }
  if (t === ReportType.NATIONAL_ANNUAL || t === ReportType.INSTITUTIONAL_ANNUAL) {
    return DistributionFrequency.ANNUAL;
  }
  return DistributionFrequency.AUTO;
}

async function handle(req: NextRequest) {
  const now = new Date();
  const isCron = isCronRequest(req);
  if (!isCron) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const run = await prisma.jobRun.create({
    data: { name: "distribution", status: JobRunStatus.RUNNING, period: null, ip: null, userId: null },
    select: { id: true },
  });

  let processed = 0;
  let queuedEmails = 0;
  let queuedWebhooks = 0;
  const errors: Array<{ id: string; error: string }> = [];

  try {
    const profiles = await prisma.distributionProfile.findMany({
      where: { active: true },
      select: {
        id: true,
        reportType: true,
        format: true,
        destination: true,
        frequency: true,
        lastRunPeriod: true,
        integrationId: true,
        emailTo: true,
        webhookUrl: true,
        integration: {
          select: {
            id: true,
            kind: true,
            scope: true,
            companyId: true,
            city: true,
            state: true,
            officialEmail: true,
            webhookUrl: true,
            webhookMethod: true,
            webhookHeaders: true,
          },
        },
      },
      take: 2000,
    });

    const appUrl = appUrlFromEnv();

    for (const p of profiles) {
      const period = computeTargetPeriod(p.reportType, now);
      if (!period) continue;
      if (p.lastRunPeriod && p.lastRunPeriod === period) continue;
      const rf = reportFrequency(p.reportType);
      if (p.frequency !== DistributionFrequency.AUTO && p.frequency !== rf) continue;

      try {
        let snapshotId: string | null = null;
        let scope: ReportScope = ReportScope.PUBLIC;
        let city: string | null = null;
        let state: string | null = null;
        let companyId: string | null = null;
        let companyName: string | null = null;

        if (p.reportType === ReportType.COMPANY_MONTHLY) {
          if (p.integration.scope !== "COMPANY" || !p.integration.companyId) continue;
          companyId = p.integration.companyId;
          const r = await prisma.reportSnapshot.findFirst({
            where: { type: ReportType.COMPANY_MONTHLY, scope: ReportScope.COMPANY, period, companyId },
            select: { id: true },
          });
          if (r) {
            snapshotId = r.id;
            scope = ReportScope.COMPANY;
          } else {
            const report = await buildReport(prisma, { type: ReportType.COMPANY_MONTHLY, companyId, period });
            if (!report) continue;
            const created = await prisma.reportSnapshot.create({
              data: { type: ReportType.COMPANY_MONTHLY, scope: ReportScope.COMPANY, period: report.period, payload: report.payload, companyId },
              select: { id: true },
            });
            snapshotId = created.id;
            scope = ReportScope.COMPANY;
          }
          const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true, city: true, state: true } });
          companyName = company?.name ?? null;
          city = company?.city ?? null;
          state = company?.state ?? null;
        } else if (p.reportType === ReportType.CITY_MONTHLY || p.reportType === ReportType.INSTITUTIONAL_MONTHLY) {
          if (p.integration.scope !== "CITY" || !p.integration.city || !p.integration.state) continue;
          city = p.integration.city;
          state = p.integration.state;
          const scopeVal = p.reportType === ReportType.CITY_MONTHLY ? ReportScope.CITY : ReportScope.CITY;
          const r = await prisma.reportSnapshot.findFirst({
            where: { type: p.reportType, scope: scopeVal, period, city, state },
            select: { id: true },
          });
          if (r) {
            snapshotId = r.id;
            scope = scopeVal;
          } else {
            const report = await buildReport(prisma, { type: p.reportType, city, state, period });
            if (!report) continue;
            const created = await prisma.reportSnapshot.create({
              data: { type: p.reportType, scope: scopeVal, period: report.period, payload: report.payload, city, state },
              select: { id: true },
            });
            snapshotId = created.id;
            scope = scopeVal;
          }
        } else if (p.reportType === ReportType.REGIONAL_QUARTERLY || p.reportType === ReportType.INSTITUTIONAL_QUARTERLY) {
          if (!p.integration.state) continue;
          state = p.integration.state;
          const scopeVal = ReportScope.REGION;
          const r = await prisma.reportSnapshot.findFirst({
            where: { type: p.reportType, scope: scopeVal, period, state },
            select: { id: true },
          });
          if (r) {
            snapshotId = r.id;
            scope = scopeVal;
          } else {
            const [yearStr, qStr] = String(period).split("-Q");
            const year = Number.parseInt(yearStr, 10);
            const quarter = Number.parseInt(qStr, 10);
            const report = await buildReport(prisma, { type: p.reportType, state, year, quarter });
            if (!report) continue;
            const created = await prisma.reportSnapshot.create({
              data: { type: p.reportType, scope: scopeVal, period: report.period, payload: report.payload, state },
              select: { id: true },
            });
            snapshotId = created.id;
            scope = scopeVal;
          }
        } else if (p.reportType === ReportType.NATIONAL_ANNUAL || p.reportType === ReportType.INSTITUTIONAL_ANNUAL) {
          const scopeVal = ReportScope.NATIONAL;
          const r = await prisma.reportSnapshot.findFirst({
            where: { type: p.reportType, scope: scopeVal, period },
            select: { id: true },
          });
          if (r) {
            snapshotId = r.id;
            scope = scopeVal;
          } else {
            const year = Number.parseInt(period, 10);
            const report = await buildReport(prisma, { type: p.reportType, year });
            if (!report) continue;
            const created = await prisma.reportSnapshot.create({
              data: { type: p.reportType, scope: scopeVal, period: report.period, payload: report.payload },
              select: { id: true },
            });
            snapshotId = created.id;
            scope = scopeVal;
          }
        } else {
          continue;
        }

        if (!snapshotId) continue;

        const jsonUrl = `${appUrl}/api/reports/${encodeURIComponent(snapshotId)}`;
        const xlsxSummaryUrl = `${appUrl}/api/reports/${encodeURIComponent(snapshotId)}/export?format=xlsx&table=summary`;
        const xlsxCategoriesUrl = `${appUrl}/api/reports/${encodeURIComponent(snapshotId)}/export?format=xlsx&table=categories`;
        const csvSummaryUrl = `${appUrl}/api/reports/${encodeURIComponent(snapshotId)}/export?format=csv&table=summary`;
        const csvCategoriesUrl = `${appUrl}/api/reports/${encodeURIComponent(snapshotId)}/export?format=csv&table=categories`;

        const subject = (() => {
          if (p.reportType === ReportType.CITY_MONTHLY) return `Relatório mensal SANE+ — ${city ?? ""}/${state ?? ""} — ${period}`.trim();
          if (p.reportType === ReportType.COMPANY_MONTHLY) {
            const name = companyName?.trim() || companyId || "";
            return `Relatório mensal SANE+ — ${name} — ${period}`.trim();
          }
          if (p.reportType === ReportType.REGIONAL_QUARTERLY) return `Relatório trimestral SANE+ — ${state ?? ""} — ${period}`.trim();
          if (p.reportType === ReportType.NATIONAL_ANNUAL) return `Relatório anual SANE+ — ${period}`.trim();
          return `Relatório SANE+ — ${period}`.trim();
        })();

        const lines = [
          "Olá,",
          "",
          `Um relatório institucional do SANE+ foi gerado (${p.reportType}).`,
          "",
          `Período: ${period}`,
          city && state ? `Cidade: ${city}/${state}` : null,
          state && !city ? `UF: ${state}` : null,
          companyId ? `Empresa: ${companyName?.trim() || companyId}` : null,
          "",
          "Downloads:",
          `- JSON: ${jsonUrl}`,
          `- XLSX (Resumo): ${xlsxSummaryUrl}`,
          `- XLSX (Categorias): ${xlsxCategoriesUrl}`,
          `- CSV (Resumo): ${csvSummaryUrl}`,
          `- CSV (Categorias): ${csvCategoriesUrl}`,
          "",
          "Obs.: relatórios não públicos exigem autenticação e respeitam o escopo (empresa/cidade/equipe).",
        ].filter(Boolean) as string[];
        const body = lines.join("\n");

        const dest = p.destination === "AUTO" ? p.integration.kind : p.destination;
        if (dest === "OFFICIAL_EMAIL") {
          const to = p.emailTo?.trim() || p.integration.officialEmail?.trim();
          if (to) {
            await queueEmail({
              to,
              subject,
              body: p.format === "JSON" ? `${body}\n\nJSON: ${jsonUrl}` : body,
              integrationId: p.integrationId,
              meta: { reportId: snapshotId, type: p.reportType, scope, period },
            });
            queuedEmails += 1;
          }
        } else if (dest === "WEBHOOK") {
          const url = p.webhookUrl?.trim() || p.integration.webhookUrl?.trim() || null;
          if (url) {
            const payload = {
              reportId: snapshotId,
              type: p.reportType,
              scope,
              period,
              city: city ?? null,
              state: state ?? null,
              companyId: companyId ?? null,
              downloads: {
                json: jsonUrl,
                xlsx: { summary: xlsxSummaryUrl, categories: xlsxCategoriesUrl },
                csv: { summary: csvSummaryUrl, categories: csvCategoriesUrl },
              },
              preferredFormat: p.format,
            };
            await queueWebhook({
              url,
              method: p.integration.webhookMethod ?? "POST",
              headers: p.integration.webhookHeaders as unknown as Record<string, string>,
              body: JSON.stringify(payload),
              integrationId: p.integrationId,
              meta: { reportId: snapshotId, type: p.reportType, scope, period },
            });
            queuedWebhooks += 1;
          }
        }

        await prisma.distributionProfile.update({
          where: { id: p.id },
          data: { lastRunAt: new Date(), lastRunPeriod: period, lastError: null },
          select: { id: true },
        });
        processed += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await prisma.distributionProfile.update({
          where: { id: p.id },
          data: { lastRunAt: new Date(), lastError: msg.slice(0, 900) },
          select: { id: true },
        });
        errors.push({ id: p.id, error: msg });
      }
    }

    const finishedAt = new Date();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: JobRunStatus.SUCCESS,
        finishedAt,
        durationMs: null,
        meta: { processed, queuedEmails, queuedWebhooks, errors: errors.length },
      },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, processed, queuedEmails, queuedWebhooks, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: JobRunStatus.FAILED,
        finishedAt,
        durationMs: null,
        error: message.slice(0, 1000),
        meta: { processed, queuedEmails, queuedWebhooks },
      },
      select: { id: true },
    });
    return NextResponse.json({ error: "job_failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
