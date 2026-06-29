import Link from "next/link";
import { ClipboardList, History, ListPlus, Settings, ShoppingCart } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { mockUsers } from "@/features/auth/mock-auth";
import { requireMembership } from "@/features/auth/authorization";
import { isExpectedAuthError } from "@/features/auth/errors";
import { isMockAuthEnabled } from "@/features/auth/mode";
import { ensureSeedHousehold } from "@/features/household/household.service";
import { GoogleUserControls } from "./auth-controls";
import { MockUserSwitcher } from "./mock-user-switcher";

const navItems = [
  { href: "/list", label: "List", icon: ListPlus, capability: "request" },
  { href: "/shop", label: "Shop", icon: ShoppingCart, capability: "shop" },
  { href: "/history", label: "History", icon: History, capability: "request" },
  { href: "/admin", label: "Admin", icon: Settings, capability: "administer" }
] as const;

export async function AppShell({ children }: { children: React.ReactNode }) {
  const mockMode = isMockAuthEnabled();
  if (mockMode) await ensureSeedHousehold();

  let membership;
  try {
    membership = await requireMembership();
  } catch (error) {
    if (!isExpectedAuthError(error)) throw error;
    membership = undefined;
  }

  if (!membership) {
    return <div className="public-workspace">{children}</div>;
  }

  const selectedMockEmail = membership.user.email ?? mockUsers[0].email;

  const household = membership
    ? await prisma.household.findUnique({ where: { id: membership.householdId } })
    : await prisma.household.findFirst();
  const activeTrip = household
    ? await prisma.shoppingTrip.findFirst({
        where: { householdId: household.id, status: "active" },
        include: { store: true, activeShopper: { include: { user: true } } }
      })
    : null;

  const visibleNav = navItems.filter((item) => membership?.capabilities.includes(item.capability) ?? item.href === "/list");

  return (
    <div className="shell">
      <aside className="rail" aria-label="Primary navigation">
        <div className="brand">
          <ClipboardList aria-hidden="true" />
          <span>Grocery</span>
        </div>
        <nav>
          {visibleNav.map((item) => (
            <Link key={item.href} href={item.href} className="rail-link">
              <item.icon aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{household?.name ?? "Family Grocery"}</p>
            <h1>{activeTrip ? `${activeTrip.activeShopper.user?.firstName ?? "Someone"} is shopping at ${activeTrip.store?.name ?? "Any Store"} now` : "Next grocery run"}</h1>
          </div>
          {mockMode ? (
            <MockUserSwitcher users={mockUsers} currentEmail={selectedMockEmail} />
          ) : (
            <GoogleUserControls displayName={membership.user.displayName} email={membership.user.email} />
          )}
        </header>

        {children}
      </div>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {visibleNav.map((item) => (
          <Link key={item.href} href={item.href}>
            <item.icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
