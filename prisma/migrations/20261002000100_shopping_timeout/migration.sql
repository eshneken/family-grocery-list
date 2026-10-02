ALTER TABLE "ShoppingTrip" ADD COLUMN "completionReason" TEXT NOT NULL DEFAULT 'manual';
CREATE INDEX "ShoppingTrip_status_startedAt_idx" ON "ShoppingTrip"("status", "startedAt");
