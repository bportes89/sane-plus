import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const items = await prisma.company.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      city: true,
      state: true,
      logoUrl: true,
      overallScore: true,
      solutionRate: true,
      avgResponseMs: true,
      status: true,
    },
  });

  return NextResponse.json(items);
}

