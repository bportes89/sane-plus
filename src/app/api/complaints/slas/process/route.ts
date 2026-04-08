import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";
import { processComplaintSlas } from "@/lib/complaintSlas";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret");
  const isCron = !!cronSecret && !!provided && provided === cronSecret;

  const user = isCron ? null : await requireUser();
  if (!isCron && (!user || !isStaff(user.role))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | { limit?: number; dryRun?: boolean; hoursCompanyFirstReply?: number; hoursUrgentFirstReply?: number }
    | null;

  const limit = Math.max(1, Math.min(500, typeof body?.limit === "number" ? body.limit : 200));
  const dry = !!body?.dryRun;
  const hoursCompanyFirstReply = Math.max(1, Math.min(720, typeof body?.hoursCompanyFirstReply === "number" ? body.hoursCompanyFirstReply : 48));
  const hoursUrgentFirstReply = Math.max(1, Math.min(168, typeof body?.hoursUrgentFirstReply === "number" ? body.hoursUrgentFirstReply : 6));

  const out = await processComplaintSlas(prisma, {
    actor: user ? { id: user.id, role: user.role } : null,
    hoursCompanyFirstReply,
    hoursUrgentFirstReply,
    limit,
    dryRun: dry,
    ip: req.headers.get("x-forwarded-for") ?? null,
    userAgent: req.headers.get("user-agent") ?? null,
  });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 403 });
  return NextResponse.json(out);
}
