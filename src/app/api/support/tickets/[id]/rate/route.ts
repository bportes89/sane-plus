import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { SupportTicketStatus } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";
import { addPoints } from "@/lib/badges";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  const body = (await req.json().catch(() => null)) as
    | { score?: number; comment?: string }
    | null;

  const score = typeof body?.score === "number" ? body.score : null;
  if (!score || score < 1 || score > 5) {
    return NextResponse.json({ error: "Nota inválida" }, { status: 400 });
  }

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true },
  });
  if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (ticket.userId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (ticket.status !== SupportTicketStatus.CLOSED) {
    return NextResponse.json(
      { error: "Você só pode avaliar após o encerramento." },
      { status: 400 },
    );
  }

  const comment = body?.comment?.trim() ? body.comment.trim().slice(0, 500) : null;

  await prisma.$transaction(async (tx) => {
    await tx.supportRating.upsert({
      where: { ticketId: ticket.id },
      create: { ticketId: ticket.id, userId: user.id, score, comment },
      update: { score, comment },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "RATE_SUPPORT_TICKET",
        tableName: "SupportRating",
        recordId: ticket.id,
        newData: { ticketId: ticket.id, score },
        ip: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });
  });

  await addPoints(user.id, 1);

  return NextResponse.json({ ok: true });
}
