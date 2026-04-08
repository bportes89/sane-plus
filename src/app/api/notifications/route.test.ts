import { prisma } from "@/lib/prisma";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import { UserRole } from "@/generated/prisma/client";

let mockUser: { id: string };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import type { NextRequest } from "next/server";
import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

describe("GET /api/notifications", () => {
  beforeEach(async () => {
    rateLimitTesting.reset();
    await resetDb();
    const user = await prisma.user.create({
      data: { id: "u1", email: "citizen@test.local", role: UserRole.CITIZEN },
    });
    mockUser = { id: user.id };
  });

  it("retorna itens e unreadCount", async () => {
    await prisma.notification.createMany({
      data: [
        { userId: "u1", type: "COMPLAINT_REGISTERED", title: "A", message: "a" },
        { userId: "u1", type: "MODERATION", title: "B", message: "b" },
      ],
    });

    const req = new Request("http://localhost/api/notifications?limit=40");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items?: Array<{ id: string }>; unreadCount?: number };
    expect(json.items?.length).toBe(2);
    expect(json.unreadCount).toBe(2);
  });

  it("aplica rate limit", async () => {
    const req = new Request("http://localhost/api/notifications?limit=1");
    let lastStatus = 200;
    for (let i = 0; i < 70; i += 1) {
      const res = await GET(req as unknown as NextRequest);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

