import { prisma } from "@/lib/prisma";
import { ComplaintStatus, ComplaintVisibility, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";

import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("GET /api/complaints/map", () => {
  beforeEach(async () => {
    await resetDb();
    rateLimitTesting.reset();
    await prisma.user.create({
      data: { id: "u1", email: "citizen@test.local", role: UserRole.CITIZEN },
    });
    await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste" },
    });
  });

  it("retorna pins com jitter quando anonimizada", async () => {
    await prisma.complaint.create({
      data: {
        id: "cmp_pub",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Baixa pressão",
        description: "desc",
        status: ComplaintStatus.PUBLISHED,
        visibility: ComplaintVisibility.PUBLIC,
        locationLat: -23.55,
        locationLng: -46.63,
        locationLabel: "Centro",
      },
    });
    await prisma.complaint.create({
      data: {
        id: "cmp_anon",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Água turva",
        description: "desc",
        status: ComplaintStatus.PUBLISHED,
        visibility: ComplaintVisibility.ANONYMIZED,
        locationLat: -23.55,
        locationLng: -46.63,
        locationLabel: "Centro",
      },
    });

    const res = await GET(new Request("http://localhost/api?limit=10"));
    expect(res.status).toBe(200);
    const pins = (await res.json()) as Array<{
      id: string;
      title: string;
      lat: number;
      lng: number;
    }>;
    expect(pins).toHaveLength(2);

    const pub = pins.find((p) => p.id === "cmp_pub");
    const anon = pins.find((p) => p.id === "cmp_anon");
    expect(pub).toBeTruthy();
    expect(anon).toBeTruthy();
    expect(pub!.title).toContain("Baixa pressão");
    expect(anon!.title).not.toContain("Água turva");
    expect(anon!.title).toContain("WATER");

    expect(anon!.lat).not.toBe(-23.55);
    expect(anon!.lng).not.toBe(-46.63);
  });

  it("retorna 429 ao exceder limite por IP (abuso)", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 130; i += 1) {
      last = await GET(
        new Request("http://localhost/api?limit=10", {
          headers: { "x-forwarded-for": "10.0.0.200" },
        }),
      );
    }
    expect(last?.status).toBe(429);
  });
});
