import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { NotificationType, SupportTicketStatus, UserRole } from "@/generated/prisma/client";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";

export const runtime = "nodejs";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

async function getConfigInt(key: string, fallback: number) {
  const row = await prisma.systemConfig.findUnique({ where: { key } });
  if (!row) return fallback;
  const value = Number.parseInt(row.value, 10);
  return Number.isFinite(value) ? value : fallback;
}

function safeName(input: string) {
  const base = input.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base.length ? base : "arquivo";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isStaff(user.role) && ticket.userId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const items = await prisma.supportAttachment.findMany({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(items);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.length > 0 && !contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "content_type" }, { status: 415 });
  }

  const { id } = await params;
  const user = await requireUser();
  const staff = isStaff(user.role);
  const ipClient = getClientIp(req.headers);
  const rl = rateLimit({
    key: staff
      ? `support:attachment:staff:${user.id}:${ipClient}`
      : `support:attachment:user:${user.id}:${ipClient}`,
    limit: staff ? 40 : 10,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, subject: true },
  });
  if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!staff && ticket.userId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!staff && ticket.status === SupportTicketStatus.CLOSED) {
    return NextResponse.json({ error: "Chamado encerrado" }, { status: 400 });
  }

  const maxBytes = await getConfigInt("support_upload_max_bytes", 5 * 1024 * 1024);
  const maxCount = await getConfigInt("support_upload_max_files_per_ticket", 5);
  const existingCount = await prisma.supportAttachment.count({ where: { ticketId: ticket.id } });
  if (existingCount >= maxCount) {
    return NextResponse.json({ error: "Limite de anexos atingido" }, { status: 400 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Arquivo inválido" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo inválido" }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "Arquivo inválido" }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return NextResponse.json({ error: "Arquivo excede o tamanho permitido" }, { status: 413 });
  }

  const allowed = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);
  if (!allowed.has(file.type)) {
    return NextResponse.json({ error: "Tipo de arquivo não permitido" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  const ext = path.extname(file.name || "").slice(0, 12);
  const name = safeName(path.basename(file.name || "arquivo", ext)).slice(0, 80);
  const stored = `${crypto.randomUUID()}_${name}${ext}`;

  const dir = path.join(process.cwd(), "public", "uploads", "support", ticket.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, stored), bytes);

  const url = `/uploads/support/${ticket.id}/${stored}`;

  const created = await prisma.$transaction(async (tx) => {
    const attachment = await tx.supportAttachment.create({
      data: {
        ticketId: ticket.id,
        url,
        filename: file.name || stored,
        mimeType: file.type,
        size: file.size,
      },
      select: { id: true },
    });

    if (!staff) {
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { status: SupportTicketStatus.PENDING_SUPPORT },
      });

      const staffUsers = await tx.user.findMany({
        where: { role: { in: [UserRole.MODERATOR, UserRole.ADMIN, UserRole.LEGAL] }, notifyInApp: true },
        select: { id: true },
      });
      if (staffUsers.length) {
        await tx.notification.createMany({
          data: staffUsers.map((s) => ({
            userId: s.id,
            type: NotificationType.ALERT,
            title: "Novo anexo em chamado",
            message: `O usuário enviou um anexo no chamado "${ticket.subject}".`,
            actionUrl: `/support/admin/${ticket.id}`,
          })),
        });
      }
    }

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "UPLOAD_SUPPORT_ATTACHMENT",
        tableName: "SupportAttachment",
        recordId: attachment.id,
        newData: { ticketId: ticket.id, url, mimeType: file.type, size: file.size },
        ip: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });

    return attachment;
  });

  return NextResponse.json({ ok: true, id: created.id, url });
}
