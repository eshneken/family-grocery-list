import { PrismaClient } from "@prisma/client";
import { approveMember, createHousehold, defaultStores } from "../src/features/household/household.service";

const prisma = new PrismaClient();

async function main() {
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

  const household = await createHousehold("Smith Family", "ed@example.com");

  await approveMember({
    householdId: household.id,
    email: "ed@example.com",
    firstName: "Ed",
    lastName: "Smith",
    capabilities: ["request", "shop", "administer"]
  });

  await approveMember({
    householdId: household.id,
    email: "gina@example.com",
    firstName: "Gina",
    lastName: "Smith",
    capabilities: ["request", "shop", "administer"]
  });

  await approveMember({
    householdId: household.id,
    email: "ayelet@example.com",
    firstName: "Ayelet",
    lastName: "Smith",
    capabilities: ["request"]
  });

  await approveMember({
    householdId: household.id,
    email: "wolf@example.com",
    firstName: "Wolf",
    lastName: "Smith",
    capabilities: ["request"]
  });

  const stores = await prisma.store.findMany({ where: { householdId: household.id } });
  const storeByName = new Map(stores.map((store) => [store.name, store.id]));

  const staples = [
    { canonicalName: "Bananas", category: "Produce", anyStore: true, recurringStaple: true, aliases: ["banana"] },
    { canonicalName: "Milk", category: "Dairy", anyStore: true, recurringStaple: true, aliases: ["2% milk", "two percent milk"] },
    {
      canonicalName: "Makoto Ginger Salad Dressing",
      category: "Pantry",
      defaultStoreId: storeByName.get("Giant"),
      anyStore: false,
      recurringStaple: false,
      aliases: ["makoto dressing", "ginger dressing"]
    },
    {
      canonicalName: "Peanut Butter",
      category: "Pantry",
      defaultStoreId: storeByName.get("Whole Foods"),
      anyStore: false,
      recurringStaple: false,
      aliases: ["pb"]
    },
    { canonicalName: "Deli Turkey", category: "Meat/Deli", anyStore: true, recurringStaple: false, aliases: ["turkey"] }
  ];

  for (const item of staples) {
    const { aliases, ...itemData } = item;
    const groceryItem = await prisma.groceryItem.create({
      data: {
        householdId: household.id,
        canonicalName: itemData.canonicalName,
        category: itemData.category,
        defaultStoreId: itemData.defaultStoreId ?? null,
        anyStore: itemData.anyStore,
        recurringStaple: itemData.recurringStaple
      }
    });

    await Promise.all(
      aliases.map((alias) =>
        prisma.groceryAlias.create({
          data: {
            groceryItemId: groceryItem.id,
            alias
          }
        })
      )
    );
  }

  const ed = await prisma.membership.findUniqueOrThrow({
    where: { householdId_approvedEmail: { householdId: household.id, approvedEmail: "ed@example.com" } }
  });
  const collecting = await prisma.shoppingList.findFirstOrThrow({
    where: { householdId: household.id, status: "collecting" }
  });

  await prisma.listItem.createMany({
    data: [
      {
        shoppingListId: collecting.id,
        rawText: "bananas",
        displayName: "Bananas",
        category: "Produce",
        requestedById: ed.id
      },
      {
        shoppingListId: collecting.id,
        rawText: "Makoto Ginger Salad Dressing",
        displayName: "Makoto Ginger Salad Dressing",
        category: "Pantry",
        storeId: storeByName.get("Giant"),
        requestedById: ed.id
      },
      {
        shoppingListId: collecting.id,
        rawText: "peanut butter",
        displayName: "Peanut Butter",
        category: "Pantry",
        storeId: storeByName.get("Whole Foods"),
        requestedById: ed.id
      }
    ]
  });

  console.log(`Seeded ${household.name} with stores: ${defaultStores.join(", ")}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
