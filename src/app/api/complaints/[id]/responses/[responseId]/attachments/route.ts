import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { AttachmentType, UserRole } from "@/generated/prisma/client";
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; responseId: string }> },
) {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.length > 0 && !contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "content_type" }, { status: 415 });
  }

  const { id, responseId } = await params;
  const user = await requireUser();
  if (user.role !== UserRole.COMPANY || !user.companyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ipClient = getClientIp(req.headers);
  const rl = rateLimit({
    key: `response:attachment:${user.companyId}:${ipClient}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const response = await prisma.companyResponse.findUnique({
    where: { id: responseId },
    select: { id: true, complaintId: true, companyId: true },
  });
  if (!response || response.complaintId !== id || response.companyId !== user.companyId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const maxBytes = await getConfigInt("response_upload_max_bytes", 5 * 1024 * 1024);
  const maxCount = await getConfigInt("response_upload_max_files_per_response", 5);
  const existing = await prisma.responseAttachment.count({ where: { responseId: response.id } });
  if (existing >= maxCount) {
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

  const dir = path.join(process.cwd(), "public", "uploads", "responses", response.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, stored), bytes);

  const url = `/uploads/responses/${response.id}/${stored}`;

  const created = await prisma.responseAttachment.create({
    data: {
      responseId: response.id,
      type: file.type.startsWith("image/") ? AttachmentType.PHOTO : AttachmentType.DOCUMENT,
      url,
      filename: file.name || stored,
      mimeType: file.type,
      size: file.size,
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "UPLOAD_RESPONSE_ATTACHMENT",
      tableName: "ResponseAttachment",
      recordId: created.id,
      newData: { responseId: response.id, url, mimeType: file.type, size: file.size },
      ip: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
  });

  return NextResponse.json({ ok: true, id: created.id, url });
}
