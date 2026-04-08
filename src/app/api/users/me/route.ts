import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clearSession, getCurrentUser, verifyPassword } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    city: user.city,
    state: user.state,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    role: user.role,
    points: user.points,
    notifyInApp: user.notifyInApp,
    notifyEmail: user.notifyEmail,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { name?: string; phone?: string; city?: string; state?: string; notifyInApp?: boolean; notifyEmail?: boolean }
    | null;
  if (!body) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const previousData = {
    name: user.name,
    phone: user.phone,
    city: user.city,
    state: user.state,
    notifyInApp: user.notifyInApp,
    notifyEmail: user.notifyEmail,
  };

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      name: body.name ?? user.name ?? null,
      phone: body.phone ?? user.phone ?? null,
      city: body.city ?? user.city ?? null,
      state: body.state ?? user.state ?? null,
      notifyInApp: typeof body.notifyInApp === "boolean" ? body.notifyInApp : user.notifyInApp,
      notifyEmail: typeof body.notifyEmail === "boolean" ? body.notifyEmail : user.notifyEmail,
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      city: true,
      state: true,
      status: true,
      lastLoginAt: true,
      role: true,
      points: true,
      notifyInApp: true,
      notifyEmail: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "UPDATE_PROFILE",
      tableName: "User",
      recordId: user.id,
      previousData,
      newData: {
        name: updated.name,
        phone: updated.phone,
        city: updated.city,
        state: updated.state,
        notifyInApp: updated.notifyInApp,
        notifyEmail: updated.notifyEmail,
      },
      ip: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { confirm?: string; password?: string }
    | null;

  const confirm = body?.confirm?.trim() ?? "";
  if (confirm.toUpperCase() !== "EXCLUIR") {
    return NextResponse.json({ error: "Confirmação inválida" }, { status: 400 });
  }

  const current = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, passwordHash: true },
  });
  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (current.passwordHash) {
    const password = body?.password ?? "";
    const ok = await verifyPassword(password, current.passwordHash);
    if (!ok) return NextResponse.json({ error: "Senha inválida" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "DELETE_ACCOUNT",
        tableName: "User",
        recordId: user.id,
        newData: { requestedBy: user.id },
        ip: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });
    await tx.user.delete({ where: { id: user.id } });
  });

  await clearSession();

  return NextResponse.json({ ok: true });
}
