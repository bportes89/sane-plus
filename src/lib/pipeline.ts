import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { PipelineDataset } from "@/generated/prisma/client";

function stableStringify(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function sha256OfJson(value: unknown) {
  const input = stableStringify(value);
  return createHash("sha256").update(input).digest("hex");
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function readRetentionConfig() {
  const retentionDays = clampInt(process.env.SNAPSHOT_RETENTION_DAYS, 7, 3650, 180);
  const maxVersionsPerKey = clampInt(process.env.SNAPSHOT_RETENTION_MAX_VERSIONS, 1, 200, 20);
  return { retentionDays, maxVersionsPerKey };
}

function isUniqueConstraintError(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "P2002";
}

function diffPaths(a: unknown, b: unknown, maxDepth = 2) {
  const out: string[] = [];

  function walk(x: unknown, y: unknown, path: string, depth: number) {
    if (depth > maxDepth) return;
    if (x === y) return;

    const xArr = Array.isArray(x) ? (x as unknown[]) : null;
    const yArr = Array.isArray(y) ? (y as unknown[]) : null;
    if (xArr || yArr) {
      if (xArr && yArr && xArr.length === yArr.length && depth < maxDepth) {
        for (let i = 0; i < xArr.length; i += 1) {
          walk(xArr[i], yArr[i], `${path}[${i}]`, depth + 1);
        }
        return;
      }
      out.push(path);
      return;
    }

    const xObj = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    const yObj = y && typeof y === "object" ? (y as Record<string, unknown>) : null;
    if (!xObj || !yObj) {
      out.push(path);
      return;
    }

    const keys = new Set<string>([...Object.keys(xObj), ...Object.keys(yObj)]);
    for (const k of [...keys].sort((m, n) => m.localeCompare(n))) {
      const next = path ? `${path}.${k}` : k;
      if (!(k in xObj) || !(k in yObj)) {
        out.push(next);
        continue;
      }
      walk(xObj[k], yObj[k], next, depth + 1);
    }
  }

  walk(a, b, "", 0);
  return [...new Set(out.filter((p) => p))].slice(0, 120);
}

export async function createPipelineSnapshotIfChanged(
  prisma: PrismaClient,
  args: {
    runId: string;
    dataset: PipelineDataset;
    period: string;
    companyId?: string | null;
    city?: string | null;
    state?: string | null;
    previousHash?: string | null;
    outputHash: string;
    payload: unknown;
  },
) {
  const key = {
    dataset: args.dataset,
    period: args.period,
    companyId: args.companyId ?? null,
    city: args.city ?? null,
    state: args.state ?? null,
  };

  const latest = await prisma.pipelineSnapshot.findFirst({
    where: key,
    orderBy: { version: "desc" },
    select: { id: true, version: true, outputHash: true, payload: true },
  });

  if (latest && latest.outputHash === args.outputHash) return { created: false as const, version: latest.version };

  const version = (latest?.version ?? 0) + 1;
  const previousHash = latest?.outputHash ?? (args.previousHash ?? null);
  const changeSummary = latest ? { changedPaths: diffPaths(latest.payload, args.payload) } : { changedPaths: [] as string[] };

  try {
    await prisma.pipelineSnapshot.create({
      data: {
        runId: args.runId,
        dataset: args.dataset,
        period: args.period,
        companyId: key.companyId ?? undefined,
        city: key.city ?? undefined,
        state: key.state ?? undefined,
        version,
        previousHash: previousHash ?? undefined,
        outputHash: args.outputHash,
        payload: args.payload as never,
        changeSummary,
      },
      select: { id: true },
    });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    const existing = await prisma.pipelineSnapshot.findFirst({
      where: { ...key, outputHash: args.outputHash },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return { created: false as const, version: existing?.version ?? version };
  }

  const { maxVersionsPerKey } = readRetentionConfig();
  if (version > maxVersionsPerKey) {
    const keep = await prisma.pipelineSnapshot.findMany({
      where: key,
      orderBy: { version: "desc" },
      skip: maxVersionsPerKey,
      take: 1000,
      select: { id: true },
    });
    if (keep.length) {
      await prisma.pipelineSnapshot.deleteMany({
        where: { id: { in: keep.map((x) => x.id) } },
      });
    }
  }

  return { created: true as const, version };
}

export async function prunePipelineSnapshotsByAge(prisma: PrismaClient, args?: { retentionDays?: number }) {
  const { retentionDays: defaultDays } = readRetentionConfig();
  const retentionDays = clampInt(args?.retentionDays ?? defaultDays, 1, 3650, defaultDays);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  await prisma.pipelineSnapshot.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
}
