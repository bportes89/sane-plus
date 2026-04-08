-- CreateTable
CREATE TABLE "FAQArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "subject" TEXT NOT NULL,
    "complaintId" TEXT,
    "deviceModel" TEXT,
    "appVersion" TEXT,
    "firstStaffReplyAt" DATETIME,
    "closedAt" DATETIME,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupportTicket_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderRole" TEXT,
    "body" TEXT NOT NULL,
    "originalBody" TEXT,
    "flags" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupportMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupportRating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportRating_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupportRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FAQArticle_slug_key" ON "FAQArticle"("slug");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_category_createdAt_idx" ON "SupportTicket"("category", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessage_senderUserId_createdAt_idx" ON "SupportMessage"("senderUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportRating_ticketId_key" ON "SupportRating"("ticketId");

-- CreateIndex
CREATE INDEX "SupportRating_userId_createdAt_idx" ON "SupportRating"("userId", "createdAt");
