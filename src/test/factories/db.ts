import type { Capability } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { approveMember, createHousehold } from "@/features/household/household.service";

export type TestHousehold = Awaited<ReturnType<typeof createTestHousehold>>;

export async function createTestHousehold(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const adminEmail = `admin-${label}-${suffix}@example.com`;
  const household = await createHousehold(`Test ${label} ${suffix}`, adminEmail);
  const admin = await prisma.membership.findUniqueOrThrow({
    where: {
      householdId_approvedEmail: {
        householdId: household.id,
        approvedEmail: adminEmail
      }
    },
    include: { user: true }
  });
  const stores = await prisma.store.findMany({
    where: { householdId: household.id },
    orderBy: { name: "asc" }
  });

  return { household, admin, stores, emails: [adminEmail] };
}

export async function addTestMember(
  testHousehold: TestHousehold,
  label: string,
  capabilities: Capability[] = ["request", "shop"]
) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  testHousehold.emails.push(email);
  return approveMember({
    householdId: testHousehold.household.id,
    email,
    firstName: label,
    lastName: "Tester",
    capabilities
  });
}

export async function addCatalogItem(input: {
  householdId: string;
  canonicalName: string;
  category: string;
  storeId?: string | null;
  recurringStaple?: boolean;
  aliases?: string[];
}) {
  const item = await prisma.groceryItem.create({
    data: {
      householdId: input.householdId,
      canonicalName: input.canonicalName,
      category: input.category,
      defaultStoreId: input.storeId ?? null,
      anyStore: !input.storeId,
      recurringStaple: input.recurringStaple ?? false
    }
  });

  await Promise.all(
    (input.aliases ?? []).map((alias) =>
      prisma.groceryAlias.create({
        data: {
          groceryItemId: item.id,
          alias: alias.toLowerCase()
        }
      })
    )
  );

  return item;
}

export async function cleanupTestHousehold(testHousehold: TestHousehold) {
  const householdId = testHousehold.household.id;
  const memberships = await prisma.membership.findMany({
    where: { householdId },
    select: { id: true }
  });
  const membershipIds = memberships.map((membership) => membership.id);
  const lists = await prisma.shoppingList.findMany({
    where: { householdId },
    select: { id: true }
  });
  const listIds = lists.map((list) => list.id);
  const listItems = await prisma.listItem.findMany({
    where: { shoppingListId: { in: listIds } },
    select: { id: true }
  });
  const listItemIds = listItems.map((item) => item.id);

  await prisma.itemOutcome.deleteMany({
    where: { OR: [{ listItemId: { in: listItemIds } }, { actorId: { in: membershipIds } }] }
  });
  await prisma.correction.deleteMany({
    where: { OR: [{ householdId }, { createdById: { in: membershipIds } }] }
  });
  await prisma.shoppingTrip.deleteMany({ where: { householdId } });
  await prisma.listItem.deleteMany({ where: { shoppingListId: { in: listIds } } });
  await prisma.household.delete({ where: { id: householdId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { in: testHousehold.emails } } });
}
