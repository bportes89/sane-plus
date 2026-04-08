import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { UserRole } from "@/generated/prisma/client";
import { SupportAdminTicketClient } from "./SupportAdminTicketClient";

function isStaff(role: UserRole) {
  return role === UserRole.MODERATOR || role === UserRole.ADMIN || role === UserRole.LEGAL;
}

export default async function SupportAdminTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/home");

  const { id } = await params;
  return <SupportAdminTicketClient ticketId={id} />;
}
