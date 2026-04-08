import { prisma } from "@/lib/prisma";

export async function queueEmail(args: {
  to: string | null | undefined;
  subject: string;
  body: string;
  userId?: string | null;
  ticketId?: string | null;
  complaintId?: string | null;
  integrationId?: string | null;
  meta?: Record<string, unknown>;
}) {
  if (!args.to) return null;
  if (args.userId) {
    const u = await prisma.user.findUnique({
      where: { id: args.userId },
      select: { notifyEmail: true },
    });
    if (u && !u.notifyEmail) return null;
  }
  const item = await prisma.emailOutbox.create({
    data: {
      to: args.to,
      subject: args.subject,
      body: args.body,
      userId: args.userId ?? null,
      ticketId: args.ticketId ?? null,
      complaintId: args.complaintId ?? null,
      integrationId: args.integrationId ?? null,
      meta: args.meta ? (args.meta as unknown as object) : undefined,
    },
    select: { id: true },
  });
  return item.id;
}
