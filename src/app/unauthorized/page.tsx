import { GoogleAccountRecoveryButton } from "@/components/auth-controls";
import { isMockAuthEnabled } from "@/features/auth/mode";

export default function UnauthorizedPage() {
  const mockMode = isMockAuthEnabled();

  return (
    <main className="page page-narrow">
      <section className="empty-state" aria-live="polite">
        <h1>This Google account is not approved for this household.</h1>
        <p>Ask the household administrator to add your email and assign the right capabilities.</p>
        {mockMode ? null : <GoogleAccountRecoveryButton />}
      </section>
    </main>
  );
}
