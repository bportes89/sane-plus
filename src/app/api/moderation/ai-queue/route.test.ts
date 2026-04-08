import { prisma } from "@/lib/prisma";
import {
  AiModerationFeedbackOutcome,
  AiModerationQueueStatus,
  AiModerationSuggestionStatus,
  ComplaintCategory,
  ComplaintStatus,
  ComplaintVisibility,
  ModerationActionType,
  UserRole,
} from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { GET as LIST } from "./route";
import { POST as APPLY } from "./[id]/apply/route";
import { POST as DISMISS } from "./[id]/dismiss/route";
import { GET as METRICS } from "../ai-metrics/route";

async function resetDb() {
  await prisma.$transaction([
    prisma.aiModerationFeedback.deleteMany(),
    prisma.aiModerationQueueItem.deleteMany(),
    prisma.aiModerationSuggestion.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.moderationAction.deleteMany(),
    prisma.complaintEvent.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("IA moderação (fila + apply/dismiss + métricas)", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.company.create({ data: { id: "c1", name: "Companhia", slug: "companhia" } });
    await prisma.user.create({ data: { id: "u_cit", email: "cit@test.local", role: UserRole.CITIZEN } });
    await prisma.user.create({ data: { id: "u_mod", email: "mod@test.local", role: UserRole.MODERATOR } });
    mockUser = { id: "u_mod", role: UserRole.MODERATOR };

    await prisma.complaint.create({
      data: {
        id: "p1",
        userId: "u_cit",
        companyId: "c1",
        category: ComplaintCategory.WATER,
        issue: "Falta de água",
        description: "Sem água.",
        status: ComplaintStatus.NEEDS_REVIEW,
        visibility: ComplaintVisibility.PRIVATE,
      },
    });
  });

  it("LIST retorna itens pendentes", async () => {
    const s = await prisma.aiModerationSuggestion.create({
      data: {
        target: "COMPLAINT",
        complaintId: "p1",
        provider: "heuristic",
        promptVersion: "test",
        input: { t: 1 },
        output: { t: 2 },
        recommendedAction: ModerationActionType.HIDDEN,
        score: 0.7,
        explanation: { summary: "revisar" },
      },
      select: { id: true },
    });
    await prisma.aiModerationQueueItem.create({ data: { suggestionId: s.id, priority: 70 } });

    const req = new Request("http://localhost/api/moderation/ai-queue?limit=10");
    const res = await LIST(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Array<{ id: string }>;
    expect(json).toHaveLength(1);
  });

  it("APPLY aplica ação e resolve fila/sugestão/feedback", async () => {
    const s = await prisma.aiModerationSuggestion.create({
      data: {
        target: "COMPLAINT",
        complaintId: "p1",
        provider: "heuristic",
        promptVersion: "test",
        input: { t: 1 },
        output: { t: 2 },
        recommendedAction: ModerationActionType.HIDDEN,
        score: 0.7,
        explanation: { summary: "revisar" },
      },
      select: { id: true },
    });
    const q = await prisma.aiModerationQueueItem.create({ data: { suggestionId: s.id, priority: 70 }, select: { id: true } });

    const req = new Request(`http://localhost/api/moderation/ai-queue/${q.id}/apply`, { method: "POST" });
    const res = await APPLY(req as unknown as NextRequest, { params: Promise.resolve({ id: q.id }) });
    expect(res.status).toBe(200);

    const [queue, sugg, feedback, mod] = await prisma.$transaction([
      prisma.aiModerationQueueItem.findUnique({ where: { id: q.id } }),
      prisma.aiModerationSuggestion.findUnique({ where: { id: s.id } }),
      prisma.aiModerationFeedback.findMany({ where: { suggestionId: s.id } }),
      prisma.moderationAction.findFirst({ where: { aiSuggestionId: s.id } }),
    ]);
    expect(queue?.status).toBe(AiModerationQueueStatus.RESOLVED);
    expect(sugg?.status).toBe(AiModerationSuggestionStatus.APPLIED);
    expect(feedback).toHaveLength(1);
    expect(feedback[0]?.outcome).toBe(AiModerationFeedbackOutcome.ACCEPTED);
    expect(mod?.action).toBe(ModerationActionType.HIDDEN);
  });

  it("DISMISS marca como dispensada e registra feedback", async () => {
    const s = await prisma.aiModerationSuggestion.create({
      data: {
        target: "COMPLAINT",
        complaintId: "p1",
        provider: "heuristic",
        promptVersion: "test",
        input: { t: 1 },
        output: { t: 2 },
        recommendedAction: ModerationActionType.EDITED,
        recommendedEdits: { description: "x" },
        score: 0.6,
        explanation: { summary: "ajustar" },
      },
      select: { id: true },
    });
    const q = await prisma.aiModerationQueueItem.create({ data: { suggestionId: s.id, priority: 60 }, select: { id: true } });

    const req = new Request(`http://localhost/api/moderation/ai-queue/${q.id}/dismiss`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "não faz sentido" }),
    });
    const res = await DISMISS(req as unknown as NextRequest, { params: Promise.resolve({ id: q.id }) });
    expect(res.status).toBe(200);

    const [queue, sugg, feedback] = await prisma.$transaction([
      prisma.aiModerationQueueItem.findUnique({ where: { id: q.id } }),
      prisma.aiModerationSuggestion.findUnique({ where: { id: s.id } }),
      prisma.aiModerationFeedback.findMany({ where: { suggestionId: s.id } }),
    ]);
    expect(queue?.status).toBe(AiModerationQueueStatus.RESOLVED);
    expect(sugg?.status).toBe(AiModerationSuggestionStatus.DISMISSED);
    expect(feedback).toHaveLength(1);
    expect(feedback[0]?.outcome).toBe(AiModerationFeedbackOutcome.REJECTED);
  });

  it("METRICS retorna janela e aceitação", async () => {
    await prisma.aiModerationSuggestion.create({
      data: {
        target: "COMPLAINT",
        complaintId: "p1",
        provider: "heuristic",
        promptVersion: "test",
        input: { t: 1 },
        output: { t: 2 },
        recommendedAction: ModerationActionType.HIDDEN,
        score: 0.7,
        explanation: { summary: "revisar" },
      },
      select: { id: true },
    });

    const res = await METRICS();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { windowDays: number; suggestions: number; feedback: { acceptanceRate: number } };
    expect(json.windowDays).toBe(30);
    expect(json.suggestions).toBeGreaterThanOrEqual(1);
    expect(json.feedback.acceptanceRate).toBeGreaterThanOrEqual(0);
  });
});
