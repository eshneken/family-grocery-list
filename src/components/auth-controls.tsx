"use client";

import { signIn, signOut } from "next-auth/react";
import { useTransition } from "react";

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

export function GoogleUserControls({ displayName, email }: { displayName: string; email: string }) {
  return (
    <div className="auth-controls">
      <span>
        <strong>{displayName}</strong>
        <small>{email}</small>
      </span>
      <button className="secondary-button" onClick={() => void signOut({ callbackUrl: "/login" })} type="button">
        Sign out
      </button>
    </div>
  );
}

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
