import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  const allowedRoles: UserRole[] = [UserRole.MODERATOR, UserRole.LEGAL, UserRole.ADMIN];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const item = await prisma.moderationAction.findUnique({
    where: { id },
    include: {
      complaint: { select: { id: true, issue: true, status: true, userId: true } },
      moderator: { select: { id: true, name: true, email: true, role: true } },
    },
  });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(item);
}
