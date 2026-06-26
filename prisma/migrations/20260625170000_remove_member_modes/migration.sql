ALTER TABLE "Membership" DROP COLUMN IF EXISTS "defaultMode";
ALTER TABLE "Membership" DROP COLUMN IF EXISTS "lastSelectedMode";
DROP TYPE IF EXISTS "CurrentMode";
