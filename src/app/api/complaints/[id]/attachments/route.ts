import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  AttachmentType,
  ComplaintEventType,
  ComplaintStatus,
  NotificationType,
} from "@/generated/prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";

export const runtime = "nodejs";

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

  const complaint = await prisma.complaint.findUnique({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!complaint) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const items = await prisma.attachment.findMany({
    where: { complaintId: complaint.id },
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
  const ipClient = getClientIp(req.headers);
  const rl = rateLimit({ key: `complaint:attachment:${user.id}:${ipClient}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const complaint = await prisma.complaint.findUnique({
    where: { id, userId: user.id },
    select: { id: true, status: true },
  });
  if (!complaint) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const canUpload = new Set<ComplaintStatus>([
    ComplaintStatus.REGISTERED,
    ComplaintStatus.NEEDS_REVIEW,
    ComplaintStatus.PUBLISHED,
    ComplaintStatus.COMPANY_VIEWED,
    ComplaintStatus.COMPANY_REPLIED,
    ComplaintStatus.USER_CONTESTED,
  ]);
  if (!canUpload.has(complaint.status)) {
    return NextResponse.json({ error: "Reclamação não aceita anexos neste status" }, { status: 400 });
  }

  const maxBytes = await getConfigInt("upload_max_bytes", 5 * 1024 * 1024);
  const maxCount = await getConfigInt("upload_max_files_per_complaint", 5);
  const existingCount = await prisma.attachment.count({ where: { complaintId: complaint.id } });
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
    "video/mp4",
  ]);
  if (!allowed.has(file.type)) {
    return NextResponse.json({ error: "Tipo de arquivo não permitido" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  const ext = path.extname(file.name || "").slice(0, 12);
  const name = safeName(path.basename(file.name || "arquivo", ext)).slice(0, 80);
  const stored = `${crypto.randomUUID()}_${name}${ext}`;

  const dir = path.join(process.cwd(), "public", "uploads", "complaints", complaint.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, stored), bytes);

  const url = `/uploads/complaints/${complaint.id}/${stored}`;
  const created = await prisma.$transaction(async (tx) => {
    const attachment = await tx.attachment.create({
      data: {
        complaintId: complaint.id,
        type: file.type.startsWith("image/")
          ? AttachmentType.PHOTO
          : file.type.startsWith("video/")
            ? AttachmentType.VIDEO
            : AttachmentType.DOCUMENT,
        url,
        filename: file.name || stored,
        mimeType: file.type,
        size: file.size,
      },
    });

    await tx.complaintEvent.create({
      data: {
        complaintId: complaint.id,
        type: ComplaintEventType.CONTENT_ADJUSTED,
        message: "Recebemos um novo anexo para comprovação.",
      },
    });

    const prefs = await tx.user.findUnique({
      where: { id: user.id },
      select: { notifyInApp: true },
    });
    if (!prefs || prefs.notifyInApp) {
      await tx.notification.create({
        data: {
          userId: user.id,
          type: NotificationType.SYSTEM,
          title: "Comprovação recebida",
          message: "Recebemos seu anexo de comprovação e vamos analisar.",
          actionUrl: `/complaints/${complaint.id}`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "UPLOAD_ATTACHMENT",
        tableName: "Attachment",
        recordId: attachment.id,
        newData: { complaintId: complaint.id, url, mimeType: file.type, size: file.size },
        ip: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });

    return attachment;
  });

  return NextResponse.json({ ok: true, id: created.id, url });
}
