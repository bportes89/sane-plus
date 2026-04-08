import type { PrismaClient } from "@/generated/prisma/client";
import { AiModerationTarget, ModerationActionType } from "@/generated/prisma/client";
import { autoModerate } from "@/lib/moderation";
import { z } from "zod";

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function toRecommendedActionFromHeuristic(flags: ReturnType<typeof autoModerate>["flags"]) {
  if (flags.xss || flags.hatefulOrSexual || flags.sensitiveData || flags.crimeAccusation) {
    return ModerationActionType.REMOVED;
  }
  if (flags.manualReview) return ModerationActionType.HIDDEN;
  if (flags.pii || flags.employeeName || flags.profanity) return ModerationActionType.EDITED;
  return null;
}

function scoreFromHeuristic(flags: ReturnType<typeof autoModerate>["flags"]) {
  if (flags.xss || flags.hatefulOrSexual) return 0.99;
  if (flags.sensitiveData || flags.crimeAccusation) return 0.95;
  if (flags.manualReview) return 0.75;
  if (flags.pii || flags.employeeName || flags.profanity) return 0.6;
  return 0.2;
}

function explanationFromHeuristic(flags: ReturnType<typeof autoModerate>["flags"]) {
  const signals: Array<{ key: string; hit: boolean }> = [
    { key: "xss", hit: flags.xss },
    { key: "pii", hit: flags.pii },
    { key: "employeeName", hit: flags.employeeName },
    { key: "profanity", hit: flags.profanity },
    { key: "crimeAccusation", hit: flags.crimeAccusation },
    { key: "hatefulOrSexual", hit: flags.hatefulOrSexual },
    { key: "sensitiveData", hit: flags.sensitiveData },
    { key: "manualReview", hit: flags.manualReview },
  ];
  const hits = signals.filter((s) => s.hit).map((s) => s.key);
  const summary = hits.length ? `Sinais detectados: ${hits.join(", ")}.` : "Sem sinais relevantes.";
  return { summary, signals };
}

const LlmSuggestionSchema = z.object({
  recommendedAction: z
    .enum([
      "EDITED",
      "HIDDEN",
      "REQUESTED_PROOF",
      "REMOVED",
      "RESTORED",
    ])
    .nullable(),
  score: z.number().min(0).max(1),
  explanation: z.object({
    summary: z.string().min(1),
    signals: z
      .array(z.object({ name: z.string().min(1), weight: z.number().min(0).max(1), detail: z.string().optional() }))
      .max(24)
      .optional(),
  }),
  recommendedEdits: z
    .object({
      issue: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
});

async function openAiSuggest(args: {
  input: {
    issue: string;
    description: string;
    category?: string | null;
    subcategory?: string | null;
    visibility?: string | null;
    heuristicFlags: ReturnType<typeof autoModerate>["flags"];
  };
}) {
  const apiKey = process.env.AI_OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.AI_OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.AI_OPENAI_MODEL ?? "gpt-4o-mini";

  const payload = {
    model,
    messages: [
      {
        role: "system",
        content:
          "Você é um classificador de moderação para uma plataforma de reclamações. Responda apenas com JSON válido.",
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Sugerir ação de moderação para reclamação",
          allowedActions: ["EDITED", "HIDDEN", "REQUESTED_PROOF", "REMOVED", "RESTORED", null],
          input: args.input,
          outputSchema: {
            recommendedAction: "string|null",
            score: "number 0..1",
            explanation: { summary: "string", signals: "array optional" },
            recommendedEdits: { issue: "string optional", description: "string optional" },
          },
        }),
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3_500);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as
      | {
          choices?: Array<{ message?: { content?: string } }>;
          model?: string;
        }
      | null;
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = LlmSuggestionSchema.safeParse(JSON.parse(content));
    if (!parsed.success) return null;
    return { provider: "openai", model: json?.model ?? model, output: parsed.data };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function createAiModerationSuggestionForComplaint(args: {
  prisma: PrismaClient;
  complaintId: string;
  issue: string;
  description: string;
  category?: string | null;
  subcategory?: string | null;
  visibility?: string | null;
}) {
  const moderated = autoModerate(args.description);
  const heuristicRecommendedAction = toRecommendedActionFromHeuristic(moderated.flags);
  const heuristicScore = scoreFromHeuristic(moderated.flags);
  const heuristicExplanation = explanationFromHeuristic(moderated.flags);

  const providerPref = process.env.AI_MODERATION_PROVIDER ?? null;
  const llm =
    providerPref === "openai" || (!providerPref && process.env.AI_OPENAI_API_KEY)
      ? await openAiSuggest({
          input: {
            issue: args.issue,
            description: moderated.output,
            category: args.category ?? null,
            subcategory: args.subcategory ?? null,
            visibility: args.visibility ?? null,
            heuristicFlags: moderated.flags,
          },
        })
      : null;

  const provider = llm?.provider ?? "heuristic";
  const model = llm?.model ?? null;
  const promptVersion = llm ? "v1_openai_json" : "v1_heuristic";

  const output = llm?.output ?? {
    recommendedAction: heuristicRecommendedAction,
    score: heuristicScore,
    explanation: { summary: heuristicExplanation.summary, signals: heuristicExplanation.signals.map((s) => ({ name: s.key, weight: s.hit ? 1 : 0 })) },
    ...(moderated.adjusted
      ? { recommendedEdits: { description: moderated.output } }
      : {}),
  };

  const suggestedAction = output.recommendedAction ? (output.recommendedAction as ModerationActionType) : null;
  const score = clamp01(output.score);

  const created = await args.prisma.aiModerationSuggestion.create({
    data: {
      target: AiModerationTarget.COMPLAINT,
      complaintId: args.complaintId,
      provider,
      model,
      promptVersion,
      input: {
        issue: args.issue,
        description: moderated.output,
        category: args.category ?? null,
        subcategory: args.subcategory ?? null,
        visibility: args.visibility ?? null,
        heuristicFlags: moderated.flags,
      },
      output,
      recommendedAction: suggestedAction,
      recommendedEdits: output.recommendedEdits ? output.recommendedEdits : undefined,
      score,
      explanation: output.explanation ?? null,
    },
    select: { id: true, recommendedAction: true },
  });

  if (created.recommendedAction) {
    await args.prisma.aiModerationQueueItem.create({
      data: { suggestionId: created.id, priority: Math.round(score * 100) },
      select: { id: true },
    });
  }

  return { ok: true as const, id: created.id };
}

export async function createAiModerationSuggestionForCompanyResponse(args: {
  prisma: PrismaClient;
  responseId: string;
  complaintId: string;
  message: string;
}) {
  const moderated = autoModerate(args.message);
  const recommendedAction =
    moderated.severity === "review"
      ? ModerationActionType.HIDDEN
      : moderated.severity === "block"
        ? ModerationActionType.REMOVED
        : null;
  const score = moderated.severity === "review" ? 0.8 : moderated.severity === "block" ? 0.95 : 0.2;
  const explanation = explanationFromHeuristic(moderated.flags);

  const created = await args.prisma.aiModerationSuggestion.create({
    data: {
      target: AiModerationTarget.COMPANY_RESPONSE,
      complaintId: args.complaintId,
      responseId: args.responseId,
      provider: "heuristic",
      model: null,
      promptVersion: "v1_heuristic_response",
      input: { message: moderated.output, flags: moderated.flags },
      output: {
        recommendedAction,
        score,
        explanation: { summary: explanation.summary, signals: explanation.signals },
      },
      recommendedAction,
      score,
      explanation: { summary: explanation.summary, signals: explanation.signals },
    },
    select: { id: true, recommendedAction: true },
  });

  if (created.recommendedAction) {
    await args.prisma.aiModerationQueueItem.create({
      data: { suggestionId: created.id, priority: Math.round(score * 100) },
      select: { id: true },
    });
  }

  return { ok: true as const, id: created.id };
}
