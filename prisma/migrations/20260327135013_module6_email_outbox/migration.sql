-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "meta" JSONB,
    "ticketId" TEXT,
    "complaintId" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME
);

-- CreateIndex
CREATE INDEX "EmailOutbox_status_createdAt_idx" ON "EmailOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_ticketId_createdAt_idx" ON "EmailOutbox"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_complaintId_createdAt_idx" ON "EmailOutbox"("complaintId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_userId_createdAt_idx" ON "EmailOutbox"("userId", "createdAt");
