"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition } from "react";
import { navItems } from "./nav-items";
import { shouldRefreshOnReturn } from "@/features/freshness/freshness";

function hasFocusedFormControl() {
  const element = document.activeElement;
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement ||
    Boolean(element?.hasAttribute("contenteditable"))
  );
}

export function MobileNav({ visibleHrefs }: { visibleHrefs: string[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const lastRefreshAt = useRef(Date.now());
  const [isRefreshing, startTransition] = useTransition();

  const refresh = useCallback(() => {
    lastRefreshAt.current = Date.now();
    startTransition(() => router.refresh());
  }, [router, startTransition]);

  useEffect(() => {
    const refreshIfStale = () => {
      if (
        shouldRefreshOnReturn({
          now: Date.now(),
          lastRefreshAt: lastRefreshAt.current,
          isOnline: navigator.onLine,
          hasOpenDialog: Boolean(document.querySelector("dialog[open]")),
          hasFocusedFormControl: hasFocusedFormControl()
        })
      ) {
        refresh();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshIfStale();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", refreshIfStale);
    window.addEventListener("online", refreshIfStale);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", refreshIfStale);
      window.removeEventListener("online", refreshIfStale);
    };
  }, [refresh]);

  return (
    <nav className="bottom-nav" aria-label="Primary navigation" aria-busy={isRefreshing}>
      {navItems
        .filter((item) => visibleHrefs.includes(item.href))
        .map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
            onClick={(event) => {
              if (pathname === item.href) {
                event.preventDefault();
                refresh();
              }
            }}
          >
            <item.icon aria-hidden="true" />
            <span>{isRefreshing && pathname === item.href ? "Updating…" : item.label}</span>
          </Link>
        ))}
    </nav>
  );
}
