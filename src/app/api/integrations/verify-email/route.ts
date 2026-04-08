import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyOfficialEmailToken } from "@/lib/integrations";

export async function GET(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get("token") ?? "").trim();
  if (!token) return NextResponse.json({ error: "missing_token" }, { status: 400 });

  const result = await verifyOfficialEmailToken({ prisma, token });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: result.id });
}

