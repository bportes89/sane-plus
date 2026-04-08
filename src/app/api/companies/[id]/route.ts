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
  const company = await prisma.company.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      cnpj: true,
      city: true,
      state: true,
      type: true,
      logoUrl: true,
      overallScore: true,
      solutionRate: true,
      avgResponseMs: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      metrics: {
        orderBy: { calculatedAt: "desc" },
        take: 6,
      },
    },
  });
  if (!company) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(company);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  if (user.role !== UserRole.COMPANY || user.companyId !== id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as
    | { name?: string; city?: string; state?: string; logoUrl?: string }
    | null;
  if (!body) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const data: Record<string, string> = {};
  if (body.city) data.city = body.city.slice(0, 80);
  if (body.state) data.state = body.state.slice(0, 2).toUpperCase();
  if (body.logoUrl) data.logoUrl = body.logoUrl.slice(0, 500);
  // Nome pode ser alterado somente se preenchido, validando tamanho razoável
  if (body.name && body.name.trim().length >= 3 && body.name.trim().length <= 120) {
    data.name = body.name.trim();
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no_changes" }, { status: 400 });
  }

  const updated = await prisma.company.update({
    where: { id },
    data,
    select: { id: true, name: true, city: true, state: true, logoUrl: true, updatedAt: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "UPDATE_COMPANY",
      tableName: "Company",
      recordId: id,
      newData: updated,
      ip: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
  });

  return NextResponse.json({ ok: true, company: updated });
}
