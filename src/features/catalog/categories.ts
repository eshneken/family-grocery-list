import { Apple, Beef, CakeSlice, Carrot, Home, Milk, Package, Snowflake } from "lucide-react";

export const categories = ["Produce", "Dairy", "Meat/Deli", "Pantry", "Frozen", "Household", "Bakery", "Other"] as const;

export const categoryIconName: Record<string, string> = {
  Produce: "Carrot",
  Dairy: "Milk",
  "Meat/Deli": "Beef",
  Pantry: "Package",
  Frozen: "Snowflake",
  Household: "Home",
  Bakery: "CakeSlice",
  Other: "Apple"
};

export const categoryIcons = {
  Produce: Carrot,
  Dairy: Milk,
  "Meat/Deli": Beef,
  Pantry: Package,
  Frozen: Snowflake,
  Household: Home,
  Bakery: CakeSlice,
  Other: Apple
};
