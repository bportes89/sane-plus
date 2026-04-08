import { prisma } from "@/lib/prisma";
import { SupportTicketStatus, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

let mockUser: { id: string; role: UserRole };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.systemConfig.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.supportAttachment.deleteMany(),
    prisma.supportMessage.deleteMany(),
    prisma.supportRating.deleteMany(),
    prisma.supportTicket.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

function ensureFileApi() {
  if (typeof File !== "undefined") return;
  class FilePolyfill extends Blob {
    name: string;
    lastModified: number;
    constructor(parts: BlobPart[], name: string, opts?: FilePropertyBag) {
      super(parts, opts);
      this.name = name;
      this.lastModified = opts?.lastModified ?? Date.now();
    }
  }
  Object.defineProperty(globalThis, "File", { value: FilePolyfill });
}

async function seed() {
  await prisma.user.create({
    data: { id: "u1", email: "citizen@test.local", role: UserRole.CITIZEN, notifyInApp: true, notifyEmail: true },
  });
  await prisma.supportTicket.create({
    data: { id: "t1", userId: "u1", category: "GENERAL", status: SupportTicketStatus.OPEN, subject: "Ajuda" },
  });
}

describe("POST /api/support/tickets/[id]/attachments", () => {
  beforeEach(async () => {
    rateLimitTesting.reset();
    await resetDb();
    ensureFileApi();
    await seed();
    mockUser = { id: "u1", role: UserRole.CITIZEN };
  });

  it("retorna 415 quando content-type não é multipart", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "x" }),
    });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(415);
  });

  it("retorna 413 quando arquivo excede o tamanho permitido", async () => {
    await prisma.systemConfig.create({
      data: { key: "support_upload_max_bytes", value: "1" },
    });

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2])], "x.png", { type: "image/png" }));
    const req = new Request("http://localhost/api", { method: "POST", body: form });

    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(413);
  });

  it("retorna 429 ao exceder limite de uploads por IP (abuso)", async () => {
    await prisma.systemConfig.create({
      data: { key: "support_upload_max_files_per_ticket", value: "999" },
    });

    let last: Response | null = null;
    for (let i = 0; i < 15; i += 1) {
      const form = new FormData();
      form.set("file", new File([new Uint8Array([1, 2, 3])], `f${i}.png`, { type: "image/png" }));
      const req = new Request("http://localhost/api", {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.20" },
        body: form,
      });
      last = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    }
    expect(last?.status).toBe(429);
  });
});

