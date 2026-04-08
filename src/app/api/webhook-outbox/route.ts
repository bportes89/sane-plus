import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { UserRole } from "@/generated/prisma/client";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export async function GET() {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const items = await prisma.webhookOutbox.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, url: true, method: true, status: true, error: true, createdAt: true, sentAt: true },
  });
  return NextResponse.json(items);
}

