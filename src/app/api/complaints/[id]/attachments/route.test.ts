import { prisma } from "@/lib/prisma";
import { ComplaintStatus, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

let mockUser: { id: string };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { GET, POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.systemConfig.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.complaintEvent.deleteMany(),
    prisma.attachment.deleteMany(),
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

describe("GET/POST /api/complaints/[id]/attachments", () => {
  beforeEach(async () => {
    await resetDb();
    ensureFileApi();
    rateLimitTesting.reset();
    await prisma.user.create({
      data: { id: "u1", email: "citizen@test.local", role: UserRole.CITIZEN, notifyInApp: true },
    });
    await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste" },
    });
    mockUser = { id: "u1" };
  });

  it("GET lista anexos do usuário", async () => {
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.NEEDS_REVIEW,
        visibility: "PRIVATE",
      },
    });
    await prisma.attachment.create({
      data: {
        complaintId: "cmp1",
        type: "DOCUMENT",
        url: "/uploads/x.pdf",
        filename: "x.pdf",
        mimeType: "application/pdf",
        size: 10,
      },
    });

    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
  });

  it("POST rejeita quando reclamação não aceita anexos no status atual", async () => {
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.CLOSED,
        visibility: "PRIVATE",
      },
    });

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }));
    const req = new Request("http://localhost/api", { method: "POST", body: form });

    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(400);
  });

  it("POST permite upload quando reclamação está publicada", async () => {
    await prisma.systemConfig.create({
      data: { key: "upload_max_files_per_complaint", value: "5" },
    });
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.PUBLISHED,
        visibility: "PUBLIC",
      },
    });

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "x.mp4", { type: "video/mp4" }));
    const req = new Request("http://localhost/api", { method: "POST", body: form });

    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(200);
  });

  it("POST salva anexo e cria evento/notificação", async () => {
    await prisma.systemConfig.create({
      data: { key: "upload_max_files_per_complaint", value: "5" },
    });
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.NEEDS_REVIEW,
        visibility: "PRIVATE",
      },
    });

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "foto.png", { type: "image/png" }));
    const req = new Request("http://localhost/api", { method: "POST", body: form });

    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(200);

    const attachments = await prisma.attachment.findMany({ where: { complaintId: "cmp1" } });
    expect(attachments).toHaveLength(1);

    const events = await prisma.complaintEvent.findMany({ where: { complaintId: "cmp1" } });
    expect(events.some((e) => e.message.includes("novo anexo"))).toBe(true);

    const notes = await prisma.notification.findMany({ where: { userId: "u1" } });
    expect(notes.some((n) => n.title === "Comprovação recebida")).toBe(true);
  });

  it("POST retorna 415 quando content-type não é multipart", async () => {
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.NEEDS_REVIEW,
        visibility: "PRIVATE",
      },
    });

    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "x" }),
    });

    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(415);
  });

  it("POST retorna 413 quando arquivo excede o tamanho permitido", async () => {
    await prisma.systemConfig.create({
      data: { key: "upload_max_bytes", value: "1" },
    });
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.NEEDS_REVIEW,
        visibility: "PRIVATE",
      },
    });

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2])], "x.png", { type: "image/png" }));
    const req = new Request("http://localhost/api", { method: "POST", body: form });

    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(413);
  });

  it("POST retorna 429 ao exceder limite de uploads por IP (abuso)", async () => {
    await prisma.systemConfig.create({
      data: { key: "upload_max_files_per_complaint", value: "999" },
    });
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.NEEDS_REVIEW,
        visibility: "PRIVATE",
      },
    });

    let last: Response | null = null;
    for (let i = 0; i < 15; i += 1) {
      const form = new FormData();
      form.set("file", new File([new Uint8Array([1, 2, 3])], `f${i}.png`, { type: "image/png" }));
      const req = new Request("http://localhost/api", {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.9" },
        body: form,
      });
      last = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    }

    expect(last?.status).toBe(429);
  });
});
