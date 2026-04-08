import { prisma } from "@/lib/prisma";
import { ComplaintStatus, UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";
import * as XLSX from "xlsx";

let mockUser: { id: string; role: UserRole; companyId: string | null };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.companyResponse.deleteMany(),
    prisma.complaintEvent.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("GET /api/companies/[id]/complaints/export", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste" },
    });
    await prisma.user.create({
      data: { id: "u_company", email: "company@test.local", role: UserRole.COMPANY, companyId: "c1" },
    });
    await prisma.user.create({
      data: { id: "u_citizen", email: "citizen@test.local", role: UserRole.CITIZEN },
    });
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1" };
  });

  it("retorna 403 quando empresa não corresponde", async () => {
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "other" };
    const req = new Request("http://localhost/api?status=ALL");
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(403);
  });

  it("exporta CSV e respeita filtro OPEN", async () => {
    await prisma.complaint.createMany({
      data: [
        {
          id: "cmp_open_1",
          userId: "u_citizen",
          companyId: "c1",
          category: "WATER",
          issue: "Sem água",
          description: "desc",
          status: ComplaintStatus.REGISTERED,
          visibility: "PUBLIC",
        },
        {
          id: "cmp_open_2",
          userId: "u_citizen",
          companyId: "c1",
          category: "WATER",
          issue: "Baixa pressão",
          description: "desc",
          status: ComplaintStatus.PUBLISHED,
          visibility: "PUBLIC",
        },
        {
          id: "cmp_closed",
          userId: "u_citizen",
          companyId: "c1",
          category: "WATER",
          issue: "Resolvida",
          description: "desc",
          status: ComplaintStatus.RESOLVED,
          visibility: "PUBLIC",
        },
      ],
    });

    const req = new Request("http://localhost/api?status=OPEN&limit=50");
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");

    const csv = await res.text();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("id,category,subcategory,issue,status,visibility");
    expect(lines.some((l) => l.includes("cmp_open_1"))).toBe(true);
    expect(lines.some((l) => l.includes("cmp_open_2"))).toBe(true);
    expect(lines.some((l) => l.includes("cmp_closed"))).toBe(false);
  });

  it("exporta XLSX com colunas básicas", async () => {
    await prisma.complaint.create({
      data: {
        id: "cmp_xlsx_1",
        userId: "u_citizen",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.REGISTERED,
        visibility: "PUBLIC",
      },
    });
    const req = new Request("http://localhost/api?format=xlsx&status=ALL&limit=10");
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml.sheet");
    const ab = await res.arrayBuffer();
    const wb = XLSX.read(Buffer.from(ab), { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0] as string];
    const rows = XLSX.utils.sheet_to_json(sheet) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0] as Record<string, unknown>;
    expect(first.id).toBe("cmp_xlsx_1");
    expect(first.category).toBe("WATER");
  });
});
