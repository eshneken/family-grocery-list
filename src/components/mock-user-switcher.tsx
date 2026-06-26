"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchMockUserEmailAction } from "@/app/actions";
import type { CurrentUser } from "@/features/auth/types";

export function MockUserSwitcher({
  users,
  currentEmail
}: {
  users: CurrentUser[];
  currentEmail: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedEmail, setSelectedEmail] = useState(currentEmail);

  useEffect(() => {
    setSelectedEmail(currentEmail);
  }, [currentEmail]);

  return (
    <div className="user-switcher">
      <label htmlFor="mock-user">Current user</label>
      <select
        id="mock-user"
        value={selectedEmail}
        disabled={isPending}
        onChange={(event) => {
          const email = event.currentTarget.value;
          setSelectedEmail(email);
          startTransition(() => {
            void switchMockUserEmailAction(email).then(() => {
              router.push("/list");
              router.refresh();
            });
          });
        }}
      >
        {users.map((user) => (
          <option key={user.email} value={user.email}>
            {user.firstName}
          </option>
        ))}
      </select>
    </div>
  );
}
