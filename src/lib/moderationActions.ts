import type { PrismaClient } from "@/generated/prisma/client";
import {
  AiModerationFeedbackOutcome,
  AiModerationQueueStatus,
  AiModerationSuggestionStatus,
  ComplaintEventType,
  ComplaintStatus,
  ComplaintVisibility,
  CompanyResponseStatus,
  ModerationActionType,
  NotificationType,
} from "@/generated/prisma/client";

function eventMessageForAction(action: ModerationActionType) {
  if (action === ModerationActionType.EDITED) return "Seu conteúdo foi ajustado para atender às regras.";
  if (action === ModerationActionType.HIDDEN) return "Sua reclamação foi ocultada para revisão.";
  if (action === ModerationActionType.REQUESTED_PROOF) {
    return "Sua reclamação foi ocultada até que você envie comprovação.";
  }
  if (action === ModerationActionType.REMOVED) return "Sua reclamação foi removida por violar nossos Termos de Uso.";
  if (action === ModerationActionType.RESTORED) return "O conteúdo foi restaurado.";
  return "A reclamação passou por moderação.";
}

function nextStatusForAction(action: ModerationActionType) {
  if (action === ModerationActionType.REMOVED) return ComplaintStatus.CLOSED;
  if (action === ModerationActionType.REQUESTED_PROOF) return ComplaintStatus.NEEDS_REVIEW;
  return ComplaintStatus.PUBLISHED;
}

export async function applyModerationAction(args: {
  prisma: PrismaClient;
  complaintId: string;
  moderatorId: string | null;
  action: ModerationActionType;
  reason?: string | null;
  details?: string | null;
  edited?: { issue?: string; description?: string } | null;
  ip?: string | null;
  userAgent?: string | null;
  aiSuggestionId?: string | null;
}) {
  const complaint = await args.prisma.complaint.findUnique({
    where: { id: args.complaintId },
    select: {
      id: true,
      userId: true,
      issue: true,
      description: true,
      status: true,
      visibility: true,
    },
  });
  if (!complaint) return { ok: false as const, error: "not_found" as const };

  const originalContent = {
    issue: complaint.issue,
    description: complaint.description,
    status: complaint.status,
    visibility: complaint.visibility,
  };

  const nextStatus = nextStatusForAction(args.action);
  const message = eventMessageForAction(args.action);

  const txResult = await args.prisma.$transaction(async (tx) => {
    const created = await tx.moderationAction.create({
      data: {
        complaintId: complaint.id,
        moderatorId: args.moderatorId,
        aiSuggestionId: args.aiSuggestionId ?? null,
        action: args.action,
        reason: args.reason ?? null,
        details: args.details ?? null,
        originalContent,
        ...(args.edited ? { editedContent: args.edited } : {}),
        moderatorIp: args.ip ?? null,
      },
      select: { id: true },
    });

    await tx.complaint.update({
      where: { id: complaint.id },
      data: {
        status: nextStatus,
        ...(args.action === ModerationActionType.HIDDEN ? { visibility: ComplaintVisibility.PRIVATE } : {}),
        ...(args.action === ModerationActionType.REQUESTED_PROOF ? { visibility: ComplaintVisibility.PRIVATE } : {}),
        ...(args.action === ModerationActionType.REMOVED ? { visibility: ComplaintVisibility.PRIVATE } : {}),
        ...(args.action === ModerationActionType.EDITED
          ? {
              issue: args.edited?.issue?.trim() ? args.edited.issue.trim() : complaint.issue,
              description: args.edited?.description?.trim()
                ? args.edited.description.trim()
                : complaint.description,
            }
          : {}),
        events: { create: { type: ComplaintEventType.CONTENT_ADJUSTED, message } },
      },
      select: { id: true },
    });

    const recipient = await tx.user.findUnique({
      where: { id: complaint.userId },
      select: { notifyInApp: true },
    });
    if (!recipient || recipient.notifyInApp) {
      await tx.notification.create({
        data: {
          userId: complaint.userId,
          type: args.action === ModerationActionType.EDITED ? NotificationType.CONTENT_ADJUSTED : NotificationType.MODERATION,
          title: "Atualização de moderação",
          message,
          actionUrl: `/complaints/${complaint.id}`,
        },
      });
    }

    if (args.aiSuggestionId) {
      await tx.aiModerationSuggestion.update({
        where: { id: args.aiSuggestionId },
        data: {
          status: AiModerationSuggestionStatus.APPLIED,
          reviewedById: args.moderatorId,
          reviewedAt: new Date(),
        },
        select: { id: true },
      });

      await tx.aiModerationQueueItem.updateMany({
        where: { suggestionId: args.aiSuggestionId },
        data: { status: AiModerationQueueStatus.RESOLVED },
      });

      await tx.aiModerationFeedback.create({
        data: {
          suggestionId: args.aiSuggestionId,
          moderatorId: args.moderatorId,
          outcome: AiModerationFeedbackOutcome.ACCEPTED,
          finalAction: args.action,
        },
        select: { id: true },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: args.moderatorId,
        action: "MODERATION_ACTION",
        tableName: "ModerationAction",
        recordId: created.id,
        newData: { action: args.action, complaintId: complaint.id, aiSuggestionId: args.aiSuggestionId ?? null },
        ip: args.ip ?? null,
        userAgent: args.userAgent ?? null,
      },
      select: { id: true },
    });

    return created.id;
  });

  return { ok: true as const, id: txResult };
}

export async function dismissAiModerationSuggestion(args: {
  prisma: PrismaClient;
  suggestionId: string;
  moderatorId: string;
  notes?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const updated = await args.prisma.$transaction(async (tx) => {
    const s = await tx.aiModerationSuggestion.update({
      where: { id: args.suggestionId },
      data: {
        status: AiModerationSuggestionStatus.DISMISSED,
        reviewedById: args.moderatorId,
        reviewedAt: new Date(),
      },
      select: { id: true },
    });

    await tx.aiModerationQueueItem.updateMany({
      where: { suggestionId: args.suggestionId },
      data: { status: AiModerationQueueStatus.RESOLVED },
    });

    await tx.aiModerationFeedback.create({
      data: {
        suggestionId: args.suggestionId,
        moderatorId: args.moderatorId,
        outcome: AiModerationFeedbackOutcome.REJECTED,
        notes: args.notes ?? null,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        userId: args.moderatorId,
        action: "AI_MODERATION_DISMISS",
        tableName: "AiModerationSuggestion",
        recordId: s.id,
        newData: { suggestionId: s.id },
        ip: args.ip ?? null,
        userAgent: args.userAgent ?? null,
      },
      select: { id: true },
    });

    return s.id;
  });

  return { ok: true as const, id: updated };
}

export async function applyCompanyResponseModerationSuggestion(args: {
  prisma: PrismaClient;
  suggestionId: string;
  moderatorId: string;
  providerLabel: string;
  queueItemId: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const suggestion = await args.prisma.aiModerationSuggestion.findUnique({
    where: { id: args.suggestionId },
    select: {
      id: true,
      responseId: true,
      recommendedAction: true,
    },
  });
  if (!suggestion?.responseId || !suggestion.recommendedAction) {
    return { ok: false as const, error: "invalid_suggestion" as const };
  }

  const response = await args.prisma.companyResponse.findUnique({
    where: { id: suggestion.responseId },
    select: { id: true, complaintId: true, message: true, status: true },
  });
  if (!response) return { ok: false as const, error: "not_found" as const };

  const action = suggestion.recommendedAction;
  const nextStatus =
    action === ModerationActionType.RESTORED
      ? CompanyResponseStatus.VISIBLE
      : CompanyResponseStatus.HIDDEN;

  const moderationAction =
    action === ModerationActionType.RESTORED
      ? ModerationActionType.RESTORED
      : ModerationActionType.HIDDEN;

  const updated = await args.prisma.$transaction(async (tx) => {
    const created = await tx.moderationAction.create({
      data: {
        complaintId: response.complaintId,
        moderatorId: args.moderatorId,
        aiSuggestionId: suggestion.id,
        action: moderationAction,
        reason: `Confirmação de sugestão por IA (${args.providerLabel})`,
        details: `companyResponseId=${response.id}; aiQueueItemId=${args.queueItemId}`,
        originalContent: { responseId: response.id, message: response.message, status: response.status },
        moderatorIp: args.ip ?? null,
      },
      select: { id: true },
    });

    await tx.companyResponse.update({
      where: { id: response.id },
      data: { status: nextStatus },
      select: { id: true },
    });

    await tx.aiModerationSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: AiModerationSuggestionStatus.APPLIED,
        reviewedById: args.moderatorId,
        reviewedAt: new Date(),
      },
      select: { id: true },
    });

    await tx.aiModerationQueueItem.updateMany({
      where: { suggestionId: suggestion.id },
      data: { status: AiModerationQueueStatus.RESOLVED },
    });

    await tx.aiModerationFeedback.create({
      data: {
        suggestionId: suggestion.id,
        moderatorId: args.moderatorId,
        outcome: AiModerationFeedbackOutcome.ACCEPTED,
        finalAction: moderationAction,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        userId: args.moderatorId,
        action: "AI_MODERATION_APPLY_RESPONSE",
        tableName: "CompanyResponse",
        recordId: response.id,
        newData: { responseId: response.id, status: nextStatus, aiSuggestionId: suggestion.id },
        ip: args.ip ?? null,
        userAgent: args.userAgent ?? null,
      },
      select: { id: true },
    });

    return created.id;
  });

  return { ok: true as const, moderationActionId: updated };
}
