import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import type { NextRequest } from "next/server";
import { UserRole } from "@/generated/prisma/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  if (user.role !== UserRole.COMPANY || user.companyId !== id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const users = await prisma.user.findMany({
    where: { companyId: id, role: UserRole.COMPANY },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  return NextResponse.json(users);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  if (user.role !== UserRole.COMPANY || user.companyId !== id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let email = "";
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { email?: string } | null;
    email = String(body?.email ?? "").trim().toLowerCase();
  } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    email = String(form.get("email") ?? "").trim().toLowerCase();
  } else {
    return NextResponse.json({ error: "unsupported" }, { status: 415 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { email } });
  if (!target) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }
  if (target.role !== UserRole.CITIZEN && target.role !== UserRole.COMPANY) {
    return NextResponse.json({ error: "Perfil incompatível" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { role: UserRole.COMPANY, companyId: id },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "ADD_COMPANY_USER",
        tableName: "User",
        recordId: target.id,
        newData: { companyId: id, role: UserRole.COMPANY },
        ip: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });
  });

  return NextResponse.json({ ok: true });
}

