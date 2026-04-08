import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, createSession } from "@/lib/auth";
import { UserRole } from "@/generated/prisma/client";
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
  const rl = rateLimit({ key: `auth:register:${ip}`, limit: 5, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const body = (await (async () => {
    if (isJson) {
      return (await req.json().catch(() => null)) as
        | { name?: string; email?: string; password?: string; phone?: string; city?: string; state?: string }
        | null;
    }
    const fd = await req.formData().catch(() => null);
    if (!fd) return null;
    return {
      name: String(fd.get("name") ?? "") || undefined,
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
      phone: String(fd.get("phone") ?? "") || undefined,
      city: String(fd.get("city") ?? "") || undefined,
      state: String(fd.get("state") ?? "") || undefined,
    };
  })()) as
    | { name?: string; email?: string; password?: string; phone?: string; city?: string; state?: string }
    | null;
  if (!body?.email || !body?.password) {
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/login?mode=register&error=${encodeURIComponent("Dados inválidos")}`, baseUrl),
      );
    }
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const exists = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true },
  });
  if (exists) {
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/login?mode=register&error=${encodeURIComponent("E-mail já cadastrado")}`, baseUrl),
      );
    }
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
  if (wantsRedirect) {
    const url = new URL(req.url);
    const next = String(url.searchParams.get("next") ?? "/home");
    const safeNext =
      next.startsWith("/") && !next.startsWith("//") ? next : "/home";
    return NextResponse.redirect(new URL(safeNext, baseUrl));
  }
  return NextResponse.json({ ok: true });
}
