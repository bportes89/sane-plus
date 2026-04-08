-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "actionUrl" TEXT;

-- CreateTable
CREATE TABLE "ResponseAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "responseId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResponseAttachment_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "CompanyResponse" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "complaintId" TEXT NOT NULL,
    "moderatorId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "details" TEXT,
    "originalContent" JSONB,
    "editedContent" JSONB,
    "moderatorIp" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModerationAction_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModerationAction_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompanyMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "complaintsReceived" INTEGER NOT NULL DEFAULT 0,
    "complaintsReplied" INTEGER NOT NULL DEFAULT 0,
    "complaintsResolved" INTEGER NOT NULL DEFAULT 0,
    "avgResponseMs" INTEGER,
    "averageScore" REAL,
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyMetric_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompanyRating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyRating_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompanyRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompanyRating_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "previousData" JSONB,
    "newData" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "complaintId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Attachment" ("complaintId", "createdAt", "filename", "id", "mimeType", "size", "url") SELECT "complaintId", "createdAt", "filename", "id", "mimeType", "size", "url" FROM "Attachment";
DROP TABLE "Attachment";
ALTER TABLE "new_Attachment" RENAME TO "Attachment";
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "cnpj" TEXT,
    "type" TEXT NOT NULL DEFAULT 'CONCESSION',
    "logoUrl" TEXT,
    "overallScore" REAL,
    "solutionRate" INTEGER,
    "avgResponseMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Company" ("city", "createdAt", "id", "name", "slug", "updatedAt") SELECT "city", "createdAt", "id", "name", "slug", "updatedAt" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");
CREATE UNIQUE INDEX "Company_cnpj_key" ON "Company"("cnpj");
CREATE TABLE "new_CompanyResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "complaintId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "authorName" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VISIBLE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyResponse_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompanyResponse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CompanyResponse" ("authorName", "companyId", "complaintId", "createdAt", "id", "message") SELECT "authorName", "companyId", "complaintId", "createdAt", "id", "message" FROM "CompanyResponse";
DROP TABLE "CompanyResponse";
ALTER TABLE "new_CompanyResponse" RENAME TO "CompanyResponse";
CREATE TABLE "new_Complaint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "issue" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "neighborhood" TEXT,
    "street" TEXT,
    "number" TEXT,
    "locationLat" REAL,
    "locationLng" REAL,
    "locationLabel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    CONSTRAINT "Complaint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Complaint_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Complaint" ("category", "companyId", "createdAt", "description", "id", "issue", "locationLabel", "locationLat", "locationLng", "resolvedAt", "status", "updatedAt", "userId") SELECT "category", "companyId", "createdAt", "description", "id", "issue", "locationLabel", "locationLat", "locationLng", "resolvedAt", "status", "updatedAt", "userId" FROM "Complaint";
DROP TABLE "Complaint";
ALTER TABLE "new_Complaint" RENAME TO "Complaint";
CREATE INDEX "Complaint_companyId_createdAt_idx" ON "Complaint"("companyId", "createdAt");
CREATE INDEX "Complaint_userId_createdAt_idx" ON "Complaint"("userId", "createdAt");
CREATE INDEX "Complaint_status_createdAt_idx" ON "Complaint"("status", "createdAt");
CREATE INDEX "Complaint_visibility_createdAt_idx" ON "Complaint"("visibility", "createdAt");
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
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "companyId" TEXT,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("companyId", "createdAt", "email", "id", "name", "passwordHash", "phone", "points", "role", "updatedAt") SELECT "companyId", "createdAt", "email", "id", "name", "passwordHash", "phone", "points", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ResponseAttachment_responseId_createdAt_idx" ON "ResponseAttachment"("responseId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_complaintId_createdAt_idx" ON "ModerationAction"("complaintId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_moderatorId_createdAt_idx" ON "ModerationAction"("moderatorId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyMetric_companyId_calculatedAt_idx" ON "CompanyMetric"("companyId", "calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMetric_companyId_period_key" ON "CompanyMetric"("companyId", "period");

-- CreateIndex
CREATE INDEX "CompanyRating_companyId_createdAt_idx" ON "CompanyRating"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyRating_userId_createdAt_idx" ON "CompanyRating"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyRating_complaintId_key" ON "CompanyRating"("complaintId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tableName_recordId_createdAt_idx" ON "AuditLog"("tableName", "recordId", "createdAt");

-- CreateIndex
CREATE INDEX "AccessLog_userId_createdAt_idx" ON "AccessLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_key_key" ON "SystemConfig"("key");
