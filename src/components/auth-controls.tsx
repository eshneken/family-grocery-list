"use client";

import { LogOut } from "lucide-react";
import { signIn, signOut } from "next-auth/react";
import { useTransition } from "react";

/** Starts an account-picker Google sign-in and exposes a pending state to prevent double clicks. */
export function GoogleSignInButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      className="primary-button"
      disabled={isPending}
      onClick={() =>
        startTransition(() => {
          void signIn("google", { callbackUrl: "/list" }, { prompt: "select_account" });
        })
      }
      type="button"
    >
      {isPending ? "Opening Google..." : "Continue with Google"}
    </button>
  );
}

/** Shows the compact signed-in identity and an icon-only sign-out affordance in the mobile header. */
export function GoogleUserControls({ firstName, imageUrl }: { firstName: string; imageUrl: string | null }) {
  return (
    <div className="auth-controls">
      {imageUrl ? (
        // Identity-provider avatars can use external hosts that are not known at build time.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="header-avatar" />
      ) : (
        <span className="header-avatar avatar-fallback" aria-hidden="true">
          {firstName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <strong className="header-user-name">{firstName}</strong>
      <button className="secondary-button header-signout" aria-label="Sign out" onClick={() => void signOut({ callbackUrl: "/login" })} type="button">
        <LogOut size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Clears the current Google session before reopening the account picker for access recovery. */
export function GoogleAccountRecoveryButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      className="primary-button"
      disabled={isPending}
      onClick={() =>
        startTransition(() => {
          void signOut({ redirect: false }).then(() =>
            signIn("google", { callbackUrl: "/list" }, { prompt: "select_account" })
          );
        })
      }
      type="button"
    >
      {isPending ? "Signing out..." : "Try another Google account"}
    </button>
  );
}
