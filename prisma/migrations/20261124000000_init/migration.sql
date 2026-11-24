-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "account_ref" TEXT NOT NULL,
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "sessions" (
    "token_hash" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "expires_at" INTEGER NOT NULL,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "destinations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bank_code" TEXT,
    "account_number" TEXT,
    "verified" BOOLEAN NOT NULL,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "destinations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "destination_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "rules_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destinations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "salary_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider_event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "received_at" TEXT NOT NULL,
    CONSTRAINT "salary_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "allocations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "salary_event_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "destination_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "allocations_salary_event_id_fkey" FOREIGN KEY ("salary_event_id") REFERENCES "salary_events" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "allocations_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "allocations_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destinations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ledger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journal_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_account_ref_key" ON "users"("account_ref");

-- CreateIndex
CREATE UNIQUE INDEX "salary_events_provider_event_id_key" ON "salary_events"("provider_event_id");

-- CreateIndex
CREATE INDEX "allocations_due_idx" ON "allocations"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "ledger_user_idx" ON "ledger"("user_id", "created_at");

