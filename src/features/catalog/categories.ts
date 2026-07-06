import { Apple, Beef, CakeSlice, Carrot, Home, Milk, Package, Snowflake } from "lucide-react";

/** Ordered category vocabulary shared by request parsing, forms, and list presentation. */
export const categories = ["Produce", "Dairy", "Meat/Deli", "Pantry", "Frozen", "Household", "Bakery", "Other"] as const;

/** Serializable icon names for places that cannot render the Lucide component directly. */
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

/** Category-to-icon component lookup used by the list rows. */
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
