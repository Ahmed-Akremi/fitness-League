-- Idempotency ledger for scheduled jobs: a (job, key) pair runs at most once to completion.
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "job_runs_job_key_key" ON "job_runs"("job", "key");

