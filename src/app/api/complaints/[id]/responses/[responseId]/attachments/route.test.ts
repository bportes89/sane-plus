import { prisma } from "@/lib/prisma";
import { UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

let mockUser: { id: string; role: UserRole; companyId: string | null };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.systemConfig.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.responseAttachment.deleteMany(),
    prisma.companyResponse.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
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

describe("POST /api/complaints/[id]/responses/[responseId]/attachments", () => {
  beforeEach(async () => {
    await resetDb();
    ensureFileApi();
    rateLimitTesting.reset();
    await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste" },
    });
    await prisma.user.create({
      data: { id: "u_company", email: "company@test.local", role: UserRole.COMPANY, companyId: "c1" },
    });
    await prisma.user.create({
      data: { id: "u_citizen", email: "citizen@test.local", role: UserRole.CITIZEN },
    });
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u_citizen",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: "PUBLISHED",
        visibility: "PUBLIC",
      },
    });
    await prisma.companyResponse.create({
      data: {
        id: "r1",
        complaintId: "cmp1",
        companyId: "c1",
        authorName: "Agente",
        message: "ok",
        status: "VISIBLE",
      },
    });
  });

  it("retorna 403 quando usuário não é empresa", async () => {
    mockUser = { id: "u_citizen", role: UserRole.CITIZEN, companyId: null };

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }));
    const req = new Request("http://localhost/api", { method: "POST", body: form });

    const res = await POST(req as unknown as NextRequest, {
      params: Promise.resolve({ id: "cmp1", responseId: "r1" }),
    });
    expect(res.status).toBe(403);
  });

  it("salva anexo e registra auditoria", async () => {
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1" };

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "doc.pdf", { type: "application/pdf" }));
    const req = new Request("http://localhost/api", { method: "POST", body: form });

    const res = await POST(req as unknown as NextRequest, {
      params: Promise.resolve({ id: "cmp1", responseId: "r1" }),
    });
    expect(res.status).toBe(200);

    const created = await prisma.responseAttachment.findMany({ where: { responseId: "r1" } });
    expect(created).toHaveLength(1);

    const audit = await prisma.auditLog.findMany({ where: { userId: "u_company", action: "UPLOAD_RESPONSE_ATTACHMENT" } });
    expect(audit).toHaveLength(1);
  });

  it("retorna 415 quando content-type não é multipart", async () => {
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1" };
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "x" }),
    });

    const res = await POST(req as unknown as NextRequest, {
      params: Promise.resolve({ id: "cmp1", responseId: "r1" }),
    });
    expect(res.status).toBe(415);
  });

  it("retorna 413 quando arquivo excede o tamanho permitido", async () => {
    await prisma.systemConfig.create({
      data: { key: "response_upload_max_bytes", value: "1" },
    });
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1" };

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2])], "x.png", { type: "image/png" }));
    const req = new Request("http://localhost/api", { method: "POST", body: form });

    const res = await POST(req as unknown as NextRequest, {
      params: Promise.resolve({ id: "cmp1", responseId: "r1" }),
    });
    expect(res.status).toBe(413);
  });

  it("retorna 429 ao exceder limite de uploads por IP (abuso)", async () => {
    await prisma.systemConfig.create({
      data: { key: "response_upload_max_files_per_response", value: "999" },
    });
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1" };

    let last: Response | null = null;
    for (let i = 0; i < 15; i += 1) {
      const form = new FormData();
      form.set("file", new File([new Uint8Array([1, 2, 3])], `d${i}.pdf`, { type: "application/pdf" }));
      const req = new Request("http://localhost/api", {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.11" },
        body: form,
      });

      last = await POST(req as unknown as NextRequest, {
        params: Promise.resolve({ id: "cmp1", responseId: "r1" }),
      });
    }
    expect(last?.status).toBe(429);
  });
});
