-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN "firstReplySlaAlertedAt" DATETIME;
ALTER TABLE "SupportTicket" ADD COLUMN "lastUserReminderAt" DATETIME;

-- CreateTable
CREATE TABLE "SupportAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "period" TEXT,
    "meta" JSONB,
    "error" TEXT,
    "ip" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT,
    CONSTRAINT "JobRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT,
    "meta" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "companyId" TEXT,
    "city" TEXT,
    "state" TEXT,
    CONSTRAINT "DataAlert_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CityMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "complaintsTotal" INTEGER NOT NULL DEFAULT 0,
    "complaintsOpen" INTEGER NOT NULL DEFAULT 0,
    "complaintsReplied" INTEGER NOT NULL DEFAULT 0,
    "complaintsResolved" INTEGER NOT NULL DEFAULT 0,
    "recurringCount" INTEGER NOT NULL DEFAULT 0,
    "avgResponseMs" INTEGER,
    "avgResolutionMs" INTEGER,
    "solutionRate" INTEGER,
    "byCategory" JSONB,
    "byNeighborhood" JSONB,
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,
    "city" TEXT,
    "state" TEXT,
    CONSTRAINT "ReportSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CITIZEN',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "points" INTEGER NOT NULL DEFAULT 0,
    "city" TEXT,
    "state" TEXT,
    "notifyInApp" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "companyId" TEXT,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("city", "companyId", "createdAt", "email", "id", "lastLoginAt", "name", "passwordHash", "phone", "points", "role", "state", "status", "updatedAt") SELECT "city", "companyId", "createdAt", "email", "id", "lastLoginAt", "name", "passwordHash", "phone", "points", "role", "state", "status", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SupportAttachment_ticketId_createdAt_idx" ON "SupportAttachment"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "JobRun_name_startedAt_idx" ON "JobRun"("name", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_status_startedAt_idx" ON "JobRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_userId_startedAt_idx" ON "JobRun"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataAlert_fingerprint_key" ON "DataAlert"("fingerprint");

-- CreateIndex
CREATE INDEX "DataAlert_scope_createdAt_idx" ON "DataAlert"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "DataAlert_companyId_createdAt_idx" ON "DataAlert"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "DataAlert_city_state_createdAt_idx" ON "DataAlert"("city", "state", "createdAt");

-- CreateIndex
CREATE INDEX "CityMetric_city_state_calculatedAt_idx" ON "CityMetric"("city", "state", "calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CityMetric_city_state_period_key" ON "CityMetric"("city", "state", "period");

-- CreateIndex
CREATE INDEX "ReportSnapshot_type_generatedAt_idx" ON "ReportSnapshot"("type", "generatedAt");

-- CreateIndex
CREATE INDEX "ReportSnapshot_companyId_generatedAt_idx" ON "ReportSnapshot"("companyId", "generatedAt");

-- CreateIndex
CREATE INDEX "ReportSnapshot_city_state_generatedAt_idx" ON "ReportSnapshot"("city", "state", "generatedAt");
