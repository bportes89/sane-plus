import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, createSession } from "@/lib/auth";
import { UserRole } from "@/generated/prisma/client";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | {
        name?: string;
        email?: string;
        password?: string;
        phone?: string;
        city?: string;
        state?: string;
      }
    | null;

  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const exists = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true },
  });
  if (exists) {
    return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: {
      name: body.name ?? null,
      email: body.email,
      phone: body.phone ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      passwordHash: await hashPassword(body.password),
      role: UserRole.CITIZEN,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "REGISTER",
      tableName: "User",
      recordId: user.id,
      newData: {
        email: user.email,
        phone: user.phone,
        city: user.city,
        state: user.state,
      },
      ip: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
  });

  await createSession(user.id);
  return NextResponse.json({ ok: true });
}

