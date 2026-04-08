import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { AutomationTrigger, UserRole } from "@/generated/prisma/client";
import { z } from "zod";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  trigger: z.nativeEnum(AutomationTrigger).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  conditions: z.unknown().optional(),
  actions: z.unknown().optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const exists = await prisma.automationRule.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.automationRule.update({
    where: { id },
    data: {
      name: parsed.data.name ?? undefined,
      trigger: parsed.data.trigger ?? undefined,
      enabled: typeof parsed.data.enabled === "boolean" ? parsed.data.enabled : undefined,
      priority: typeof parsed.data.priority === "number" ? parsed.data.priority : undefined,
      conditions: parsed.data.conditions ? (parsed.data.conditions as object) : undefined,
      actions: parsed.data.actions ? (parsed.data.actions as object) : undefined,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const exists = await prisma.automationRule.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.automationRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

