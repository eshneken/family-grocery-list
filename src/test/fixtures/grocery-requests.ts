export const groceryRequestFixtures = [
  { raw: "2 gallons milk", quantityText: "2 gallons", itemText: "milk", category: "Dairy" },
  { raw: "cherry tomatoes", quantityText: null, itemText: "cherry tomatoes", category: "Produce" },
  { raw: "pastrami", quantityText: null, itemText: "pastrami", category: "Meat/Deli" },
  { raw: "paper towels", quantityText: null, itemText: "paper towels", category: "Household" },
  { raw: "one loaf bread", quantityText: "one loaf", itemText: "bread", category: "Bakery" },
  { raw: "3 lb chicken", quantityText: "3 lb", itemText: "chicken", category: "Meat/Deli" }
] as const;
