-- CreateTable
CREATE TABLE "PipelineEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "period" TEXT,
    "companyId" TEXT,
    "city" TEXT,
    "state" TEXT,
    "inputMeta" JSONB,
    "output" JSONB,
    "previousHash" TEXT,
    "outputHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PipelineEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "JobRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PipelineEvent_dataset_createdAt_idx" ON "PipelineEvent"("dataset", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_dataset_period_createdAt_idx" ON "PipelineEvent"("dataset", "period", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_companyId_period_createdAt_idx" ON "PipelineEvent"("companyId", "period", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_city_state_period_createdAt_idx" ON "PipelineEvent"("city", "state", "period", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineEvent_runId_dataset_action_period_companyId_city_state_key" ON "PipelineEvent"("runId", "dataset", "action", "period", "companyId", "city", "state");
