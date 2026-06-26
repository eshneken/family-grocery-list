CREATE TYPE "AuthProvider" AS ENUM ('mock', 'google');
CREATE TYPE "Capability" AS ENUM ('request', 'shop', 'administer');
CREATE TYPE "MemberStatus" AS ENUM ('pending', 'active', 'disabled');
CREATE TYPE "CurrentMode" AS ENUM ('requestor', 'shopper', 'admin');
CREATE TYPE "ShoppingListStatus" AS ENUM ('collecting', 'locked', 'completed');
CREATE TYPE "ListItemStatus" AS ENUM ('pending', 'purchased', 'substituted', 'rejected', 'carried_forward');
CREATE TYPE "ShoppingTripStatus" AS ENUM ('active', 'completed');

CREATE TABLE "Household" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "displayName" TEXT,
  "imageUrl" TEXT,
  "authProvider" "AuthProvider" NOT NULL DEFAULT 'mock',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Membership" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "userId" TEXT,
  "approvedEmail" TEXT NOT NULL,
  "status" "MemberStatus" NOT NULL DEFAULT 'pending',
  "capabilities" "Capability"[],
  "defaultMode" "CurrentMode" NOT NULL DEFAULT 'requestor',
  "lastSelectedMode" "CurrentMode" NOT NULL DEFAULT 'requestor',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Store" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "categoryOrderJson" JSONB,
  CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroceryItem" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "canonicalName" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "defaultStoreId" TEXT,
  "anyStore" BOOLEAN NOT NULL DEFAULT true,
  "recurringStaple" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  CONSTRAINT "GroceryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroceryAlias" (
  "id" TEXT NOT NULL,
  "groceryItemId" TEXT NOT NULL,
  "alias" TEXT NOT NULL,
  CONSTRAINT "GroceryAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShoppingList" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "status" "ShoppingListStatus" NOT NULL DEFAULT 'collecting',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ShoppingList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListItem" (
  "id" TEXT NOT NULL,
  "shoppingListId" TEXT NOT NULL,
  "groceryItemId" TEXT,
  "rawText" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "quantityText" TEXT,
  "category" TEXT NOT NULL,
  "storeId" TEXT,
  "requestedById" TEXT NOT NULL,
  "status" "ListItemStatus" NOT NULL DEFAULT 'pending',
  "notes" TEXT,
  "substituteText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "outcomeAt" TIMESTAMP(3),
  CONSTRAINT "ListItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShoppingTrip" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "shoppingListId" TEXT NOT NULL,
  "activeShopperId" TEXT NOT NULL,
  "storeId" TEXT,
  "status" "ShoppingTripStatus" NOT NULL DEFAULT 'active',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ShoppingTrip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ItemOutcome" (
  "id" TEXT NOT NULL,
  "listItemId" TEXT NOT NULL,
  "outcome" "ListItemStatus" NOT NULL,
  "actorId" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ItemOutcome_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Correction" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "inputText" TEXT NOT NULL,
  "correctedItemId" TEXT NOT NULL,
  "correctedCategory" TEXT NOT NULL,
  "correctedStoreId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Correction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Membership_householdId_approvedEmail_key" ON "Membership"("householdId", "approvedEmail");
CREATE INDEX "Membership_householdId_status_idx" ON "Membership"("householdId", "status");
CREATE UNIQUE INDEX "Store_householdId_name_key" ON "Store"("householdId", "name");
CREATE INDEX "Store_householdId_enabled_idx" ON "Store"("householdId", "enabled");
CREATE UNIQUE INDEX "GroceryItem_householdId_canonicalName_key" ON "GroceryItem"("householdId", "canonicalName");
CREATE INDEX "GroceryItem_householdId_category_idx" ON "GroceryItem"("householdId", "category");
CREATE UNIQUE INDEX "GroceryAlias_groceryItemId_alias_key" ON "GroceryAlias"("groceryItemId", "alias");
CREATE INDEX "ShoppingList_householdId_status_idx" ON "ShoppingList"("householdId", "status");
CREATE INDEX "ShoppingList_householdId_createdAt_idx" ON "ShoppingList"("householdId", "createdAt");
CREATE INDEX "ListItem_shoppingListId_status_idx" ON "ListItem"("shoppingListId", "status");
CREATE INDEX "ListItem_shoppingListId_storeId_idx" ON "ListItem"("shoppingListId", "storeId");
CREATE INDEX "ListItem_requestedById_idx" ON "ListItem"("requestedById");
CREATE UNIQUE INDEX "ShoppingTrip_shoppingListId_key" ON "ShoppingTrip"("shoppingListId");
CREATE INDEX "ShoppingTrip_householdId_status_idx" ON "ShoppingTrip"("householdId", "status");
CREATE UNIQUE INDEX "ShoppingTrip_one_active_per_household" ON "ShoppingTrip"("householdId") WHERE "status" = 'active';
CREATE INDEX "ItemOutcome_listItemId_idx" ON "ItemOutcome"("listItemId");
CREATE INDEX "Correction_householdId_inputText_idx" ON "Correction"("householdId", "inputText");
CREATE UNIQUE INDEX "ShoppingList_one_collecting_per_household" ON "ShoppingList"("householdId") WHERE "status" = 'collecting';

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Store" ADD CONSTRAINT "Store_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroceryItem" ADD CONSTRAINT "GroceryItem_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroceryItem" ADD CONSTRAINT "GroceryItem_defaultStoreId_fkey" FOREIGN KEY ("defaultStoreId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GroceryAlias" ADD CONSTRAINT "GroceryAlias_groceryItemId_fkey" FOREIGN KEY ("groceryItemId") REFERENCES "GroceryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShoppingList" ADD CONSTRAINT "ShoppingList_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_shoppingListId_fkey" FOREIGN KEY ("shoppingListId") REFERENCES "ShoppingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_groceryItemId_fkey" FOREIGN KEY ("groceryItemId") REFERENCES "GroceryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShoppingTrip" ADD CONSTRAINT "ShoppingTrip_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShoppingTrip" ADD CONSTRAINT "ShoppingTrip_shoppingListId_fkey" FOREIGN KEY ("shoppingListId") REFERENCES "ShoppingList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShoppingTrip" ADD CONSTRAINT "ShoppingTrip_activeShopperId_fkey" FOREIGN KEY ("activeShopperId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShoppingTrip" ADD CONSTRAINT "ShoppingTrip_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ItemOutcome" ADD CONSTRAINT "ItemOutcome_listItemId_fkey" FOREIGN KEY ("listItemId") REFERENCES "ListItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItemOutcome" ADD CONSTRAINT "ItemOutcome_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_correctedItemId_fkey" FOREIGN KEY ("correctedItemId") REFERENCES "GroceryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_correctedStoreId_fkey" FOREIGN KEY ("correctedStoreId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
