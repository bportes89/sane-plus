-- CreateTable
CREATE TABLE "AiModerationSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "target" TEXT NOT NULL,
    "complaintId" TEXT,
    "responseId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "recommendedAction" TEXT,
    "recommendedEdits" JSONB,
    "score" REAL,
    "explanation" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiModerationSuggestion_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiModerationSuggestion_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "CompanyResponse" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiModerationSuggestion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiModerationQueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "suggestionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "assignedToId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiModerationQueueItem_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "AiModerationSuggestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiModerationQueueItem_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiModerationFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "suggestionId" TEXT NOT NULL,
    "moderatorId" TEXT,
    "outcome" TEXT NOT NULL,
    "finalAction" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiModerationFeedback_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "AiModerationSuggestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiModerationFeedback_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PipelineSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "companyId" TEXT,
    "city" TEXT,
    "state" TEXT,
    "version" INTEGER NOT NULL,
    "previousHash" TEXT,
    "outputHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "changeSummary" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PipelineSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "JobRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WebhookOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'POST',
    "headers" JSONB,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "meta" JSONB
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "companyId" TEXT,
    "city" TEXT,
    "state" TEXT,
    "webhookUrl" TEXT,
    "webhookMethod" TEXT DEFAULT 'POST',
    "webhookHeaders" JSONB,
    "signingSecretEnc" TEXT,
    "officialEmail" TEXT,
    "emailVerifyTokenHash" TEXT,
    "verifiedAt" DATETIME,
    "inboundTokenHash" TEXT,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Integration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExternalProtocol" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "integrationId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "externalProtocol" TEXT NOT NULL,
    "externalStatus" TEXT,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExternalProtocol_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExternalProtocol_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ModerationAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "complaintId" TEXT NOT NULL,
    "moderatorId" TEXT,
    "aiSuggestionId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "details" TEXT,
    "originalContent" JSONB,
    "editedContent" JSONB,
    "moderatorIp" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModerationAction_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModerationAction_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModerationAction_aiSuggestionId_fkey" FOREIGN KEY ("aiSuggestionId") REFERENCES "AiModerationSuggestion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ModerationAction" ("action", "complaintId", "createdAt", "details", "editedContent", "id", "moderatorId", "moderatorIp", "originalContent", "reason") SELECT "action", "complaintId", "createdAt", "details", "editedContent", "id", "moderatorId", "moderatorIp", "originalContent", "reason" FROM "ModerationAction";
DROP TABLE "ModerationAction";
ALTER TABLE "new_ModerationAction" RENAME TO "ModerationAction";
CREATE INDEX "ModerationAction_complaintId_createdAt_idx" ON "ModerationAction"("complaintId", "createdAt");
CREATE INDEX "ModerationAction_moderatorId_createdAt_idx" ON "ModerationAction"("moderatorId", "createdAt");
CREATE INDEX "ModerationAction_aiSuggestionId_createdAt_idx" ON "ModerationAction"("aiSuggestionId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AiModerationSuggestion_target_createdAt_idx" ON "AiModerationSuggestion"("target", "createdAt");

-- CreateIndex
CREATE INDEX "AiModerationSuggestion_status_createdAt_idx" ON "AiModerationSuggestion"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiModerationSuggestion_complaintId_createdAt_idx" ON "AiModerationSuggestion"("complaintId", "createdAt");

-- CreateIndex
CREATE INDEX "AiModerationSuggestion_responseId_createdAt_idx" ON "AiModerationSuggestion"("responseId", "createdAt");

-- CreateIndex
CREATE INDEX "AiModerationSuggestion_reviewedById_reviewedAt_idx" ON "AiModerationSuggestion"("reviewedById", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiModerationQueueItem_suggestionId_key" ON "AiModerationQueueItem"("suggestionId");

-- CreateIndex
CREATE INDEX "AiModerationQueueItem_status_priority_createdAt_idx" ON "AiModerationQueueItem"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "AiModerationQueueItem_assignedToId_status_createdAt_idx" ON "AiModerationQueueItem"("assignedToId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AiModerationFeedback_suggestionId_createdAt_idx" ON "AiModerationFeedback"("suggestionId", "createdAt");

-- CreateIndex
CREATE INDEX "AiModerationFeedback_moderatorId_createdAt_idx" ON "AiModerationFeedback"("moderatorId", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineSnapshot_dataset_createdAt_idx" ON "PipelineSnapshot"("dataset", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineSnapshot_dataset_period_version_idx" ON "PipelineSnapshot"("dataset", "period", "version");

-- CreateIndex
CREATE INDEX "PipelineSnapshot_companyId_period_version_idx" ON "PipelineSnapshot"("companyId", "period", "version");

-- CreateIndex
CREATE INDEX "PipelineSnapshot_city_state_period_version_idx" ON "PipelineSnapshot"("city", "state", "period", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineSnapshot_dataset_period_companyId_city_state_version_key" ON "PipelineSnapshot"("dataset", "period", "companyId", "city", "state", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineSnapshot_dataset_period_companyId_city_state_outputHash_key" ON "PipelineSnapshot"("dataset", "period", "companyId", "city", "state", "outputHash");

-- CreateIndex
CREATE INDEX "AutomationRule_trigger_enabled_priority_idx" ON "AutomationRule"("trigger", "enabled", "priority");

-- CreateIndex
CREATE INDEX "WebhookOutbox_status_createdAt_idx" ON "WebhookOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Integration_status_scope_kind_createdAt_idx" ON "Integration"("status", "scope", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "Integration_companyId_status_idx" ON "Integration"("companyId", "status");

-- CreateIndex
CREATE INDEX "Integration_city_state_status_idx" ON "Integration"("city", "state", "status");

-- CreateIndex
CREATE INDEX "ExternalProtocol_complaintId_updatedAt_idx" ON "ExternalProtocol"("complaintId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalProtocol_integrationId_complaintId_key" ON "ExternalProtocol"("integrationId", "complaintId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalProtocol_integrationId_externalProtocol_key" ON "ExternalProtocol"("integrationId", "externalProtocol");
