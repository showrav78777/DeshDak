-- CreateEnum
CREATE TYPE "AiConversationStatus" AS ENUM ('ACTIVE', 'HANDED_OFF', 'EXPIRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AiConversationMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "customerId" TEXT,
    "handoffTicketId" TEXT,
    "status" "AiConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "turnKey" TEXT NOT NULL,
    "role" "AiConversationMessageRole" NOT NULL,
    "body" TEXT NOT NULL,
    "safetyCode" TEXT,
    "handoffSuggested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiConversation_tokenHash_key" ON "AiConversation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AiConversation_handoffTicketId_key" ON "AiConversation"("handoffTicketId");

-- CreateIndex
CREATE INDEX "AiConversation_status_expiresAt_idx" ON "AiConversation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "AiConversation_customerId_lastMessageAt_idx" ON "AiConversation"("customerId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiConversationMessage_conversationId_turnKey_role_key" ON "AiConversationMessage"("conversationId", "turnKey", "role");

-- CreateIndex
CREATE INDEX "AiConversationMessage_conversationId_createdAt_idx" ON "AiConversationMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_handoffTicketId_fkey" FOREIGN KEY ("handoffTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversationMessage" ADD CONSTRAINT "AiConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
