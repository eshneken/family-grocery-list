import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function resetE2EDatabase() {
  await prisma.itemOutcome.deleteMany();
  await prisma.shoppingTrip.deleteMany();
  await prisma.listItem.deleteMany();
  await prisma.shoppingList.deleteMany();
  await prisma.groceryAlias.deleteMany();
  await prisma.groceryItem.deleteMany();
  await prisma.correction.deleteMany();
  await prisma.store.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.household.deleteMany();

  const household = await prisma.household.create({
    data: { name: "E2E Family" }
  });

  const users = await Promise.all([
    prisma.user.create({
      data: {
        email: "gina@example.com",
        firstName: "Gina",
        lastName: "Smith",
        displayName: "Gina",
        authProvider: "mock"
      }
    }),
    prisma.user.create({
      data: {
        email: "ed@example.com",
        firstName: "Ed",
        lastName: "Smith",
        displayName: "Ed",
        authProvider: "mock"
      }
    }),
    prisma.user.create({
      data: {
        email: "ayelet@example.com",
        firstName: "Ayelet",
        lastName: "Smith",
        displayName: "Ayelet",
        authProvider: "mock"
      }
    })
  ]);

  const [gina, ed, ayelet] = users;
  const memberships = await Promise.all([
    prisma.membership.create({
      data: {
        householdId: household.id,
        userId: gina.id,
        approvedEmail: gina.email,
        status: "active",
        capabilities: ["request", "shop", "administer"]
      }
    }),
    prisma.membership.create({
      data: {
        householdId: household.id,
        userId: ed.id,
        approvedEmail: ed.email,
        status: "active",
        capabilities: ["request", "shop", "administer"]
      }
    }),
    prisma.membership.create({
      data: {
        householdId: household.id,
        userId: ayelet.id,
        approvedEmail: ayelet.email,
        status: "active",
        capabilities: ["request"]
      }
    })
  ]);

  const stores = await Promise.all(
    ["Giant", "Whole Foods", "Trader Joe's"].map((name) =>
      prisma.store.create({
        data: {
          householdId: household.id,
          name,
          enabled: true,
          categoryOrderJson: ["Produce", "Dairy", "Meat/Deli", "Pantry", "Frozen", "Household", "Bakery", "Other"]
        }
      })
    )
  );
  const giant = stores.find((store) => store.name === "Giant")!;

  const milk = await prisma.groceryItem.create({
    data: {
      householdId: household.id,
      canonicalName: "Milk",
      category: "Dairy",
      recurringStaple: true,
      anyStore: true
    }
  });
  await prisma.groceryAlias.create({
    data: {
      groceryItemId: milk.id,
      alias: "milk"
    }
  });

  await prisma.groceryItem.create({
    data: {
      householdId: household.id,
      canonicalName: "Makoto Ginger Salad Dressing",
      category: "Pantry",
      defaultStoreId: giant.id,
      recurringStaple: false,
      anyStore: false
    }
  });

  const collectingList = await prisma.shoppingList.create({
    data: { householdId: household.id, status: "collecting" }
  });

  return { household, memberships, stores, collectingList };
}
