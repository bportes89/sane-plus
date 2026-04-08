import { prisma } from "@/lib/prisma";
import { WebhookStatus } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";
import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.webhookOutbox.deleteMany(),
    prisma.auditLog.deleteMany(),
  ]);
}

describe("POST /api/webhook-outbox/process", () => {
  const prevCron = process.env.CRON_SECRET;
  const prevEnabled = process.env.WEBHOOK_DELIVERY_ENABLED;

  beforeEach(async () => {
    await resetDb();
    process.env.CRON_SECRET = "test_secret";
    delete process.env.WEBHOOK_DELIVERY_ENABLED;
  });

  afterAll(() => {
    process.env.CRON_SECRET = prevCron;
    process.env.WEBHOOK_DELIVERY_ENABLED = prevEnabled;
  });

  it("dryRun marca como SENT e cria auditoria", async () => {
    await prisma.webhookOutbox.create({
      data: { id: "w1", url: "https://example.com/hook", method: "POST", body: "{\"ok\":true}", status: WebhookStatus.PENDING },
    });

    const req = new Request("http://localhost/api/webhook-outbox/process", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ limit: 10, dryRun: true }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.sent).toBe(1);

    const item = await prisma.webhookOutbox.findUnique({ where: { id: "w1" } });
    expect(item?.status).toBe(WebhookStatus.SENT);

    const audit = await prisma.auditLog.findMany({ where: { action: "PROCESS_WEBHOOK_OUTBOX" } });
    expect(audit).toHaveLength(1);
  });

  it("env desabilitado envia em modo simulado e marca SENT", async () => {
    await prisma.webhookOutbox.create({
      data: { id: "w2", url: "https://example.com/hook", method: "POST", body: "{\"x\":1}", status: WebhookStatus.PENDING },
    });

    const req = new Request("http://localhost/api/webhook-outbox/process", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ limit: 10, dryRun: false }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const item = await prisma.webhookOutbox.findUnique({ where: { id: "w2" } });
    expect(item?.status).toBe(WebhookStatus.SENT);
  });
});

