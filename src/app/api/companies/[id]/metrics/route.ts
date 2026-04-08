import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const exists = await prisma.company.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const items = await prisma.companyMetric.findMany({
    where: { companyId: id },
    orderBy: { calculatedAt: "desc" },
    take: 24,
  });
  return NextResponse.json(items);
}

