import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession } from "@/lib/auth";
import { UserStatus } from "@/generated/prisma/client";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const isForm =
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");
  if (!isJson && !isForm) {
    return NextResponse.json({ error: "content_type" }, { status: 415 });
  }
  const wantsRedirect = isForm;
  const baseUrl = (() => {
    const u = new URL(req.url);
    if (u.hostname === "0.0.0.0" || u.hostname === "::" || u.hostname === "[::]") {
      u.hostname = "localhost";
    }
    if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.protocol === "https:") {
      u.protocol = "http:";
    }
    return u;
  })();

  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `auth:login:${ip}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const body = (await (async () => {
    if (isJson) {
      return (await req.json().catch(() => null)) as
        | { email?: string; password?: string }
        | null;
    }
    const fd = await req.formData().catch(() => null);
    if (!fd) return null;
    return {
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
    };
  })()) as { email?: string; password?: string } | null;
  if (!body?.email || !body?.password) {
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent("Dados inválidos")}`, baseUrl),
      );
    }
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: body.email },
  });
  if (!user || !user.passwordHash) {
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent("Credenciais inválidas")}`, baseUrl),
      );
    }
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }

  if (user.status === UserStatus.BLOCKED) {
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent("Usuário bloqueado")}`, baseUrl),
      );
    }
    return NextResponse.json({ error: "Usuário bloqueado" }, { status: 403 });
  }

  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok) {
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent("Credenciais inválidas")}`, baseUrl),
      );
    }
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }

  const ipAudit = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now },
    }),
    prisma.accessLog.create({
      data: {
        userId: user.id,
        ip: ipAudit,
        userAgent,
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "LOGIN",
        tableName: "User",
        recordId: user.id,
        newData: { lastLoginAt: now.toISOString() },
        ip: ipAudit,
        userAgent,
      },
    }),
  ]);

  await createSession(user.id);
  if (wantsRedirect) {
    const url = new URL(req.url);
    const next = String(url.searchParams.get("next") ?? "/home");
    const safeNext =
      next.startsWith("/") && !next.startsWith("//") ? next : "/home";
    return NextResponse.redirect(new URL(safeNext, baseUrl));
  }
  return NextResponse.json({ ok: true });
}
