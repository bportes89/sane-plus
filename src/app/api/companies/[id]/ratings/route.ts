import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ComplaintStatus } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const items = await prisma.companyRating.findMany({
    where: { companyId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      score: true,
      comment: true,
      createdAt: true,
      user: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(items);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: companyId } = await params;
  const user = await requireUser();

  const body = (await req.json().catch(() => null)) as
    | { complaintId?: string; score?: number; comment?: string }
    | null;
  const score = Number(body?.score);
  if (!body?.complaintId || !Number.isFinite(score) || score < 1 || score > 5) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const complaint = await prisma.complaint.findUnique({
    where: { id: body.complaintId, userId: user.id },
    select: { id: true, status: true, companyId: true },
  });
  if (!complaint) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (complaint.companyId !== companyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (complaint.status !== ComplaintStatus.RESOLVED) {
    return NextResponse.json(
      { error: "Só é possível avaliar após marcar como resolvida" },
      { status: 400 },
    );
  }

  const comment = body.comment?.trim() ? body.comment.trim() : null;
  const ip = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const rating = await prisma.companyRating.create({
    data: {
      companyId,
      userId: user.id,
      complaintId: complaint.id,
      score: Math.trunc(score),
      comment,
    },
    select: { id: true },
  });

  const avg = await prisma.companyRating.aggregate({
    where: { companyId },
    _avg: { score: true },
  });
  const overallScore =
    typeof avg._avg.score === "number" ? Math.round(avg._avg.score * 10) / 10 : null;

  await prisma.$transaction([
    prisma.company.update({
      where: { id: companyId },
      data: { overallScore },
    }),
    prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "RATE_COMPANY",
        tableName: "CompanyRating",
        recordId: rating.id,
        newData: { companyId, complaintId: complaint.id, score, comment },
        ip,
        userAgent,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, id: rating.id, overallScore });
}

