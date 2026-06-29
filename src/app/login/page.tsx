import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth-controls";
import { isMockAuthEnabled } from "@/features/auth/mode";

export default function LoginPage() {
  if (isMockAuthEnabled()) redirect("/list");

  return (
    <main className="page page-narrow auth-page">
      <section className="empty-state">
        <p className="eyebrow">Family Grocery List</p>
        <h1>Sign in to your household</h1>
        <p>Use the Google account your household administrator approved.</p>
        <GoogleSignInButton />
      </section>
    </main>
  );
}
