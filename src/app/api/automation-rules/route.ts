import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { AutomationTrigger, UserRole } from "@/generated/prisma/client";
import { z } from "zod";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

const createSchema = z.object({
  name: z.string().min(2).max(120),
  trigger: z.nativeEnum(AutomationTrigger),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  conditions: z.unknown(),
  actions: z.unknown(),
});

export async function GET() {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rules = await prisma.automationRule.findMany({
    orderBy: [{ trigger: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      enabled: true,
      trigger: true,
      priority: true,
      conditions: true,
      actions: true,
      lastRunAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json(rules);
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const created = await prisma.automationRule.create({
    data: {
      name: parsed.data.name,
      trigger: parsed.data.trigger,
      enabled: parsed.data.enabled ?? true,
      priority: parsed.data.priority ?? 100,
      conditions: parsed.data.conditions as object,
      actions: parsed.data.actions as object,
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: created.id });
}

