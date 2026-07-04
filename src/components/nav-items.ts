import type { Capability } from "@prisma/client";
import { History, ListPlus, Settings, ShoppingCart } from "lucide-react";

export const navItems: Array<{
  href: "/list" | "/shop" | "/history" | "/admin";
  label: string;
  icon: typeof ListPlus;
  capability: Capability;
}> = [
  { href: "/list", label: "List", icon: ListPlus, capability: "request" },
  { href: "/shop", label: "Shop", icon: ShoppingCart, capability: "shop" },
  { href: "/history", label: "History", icon: History, capability: "request" },
  { href: "/admin", label: "Admin", icon: Settings, capability: "administer" }
];
