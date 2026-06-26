import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "./types";

export const mockUsers: CurrentUser[] = [
  {
    id: "mock-gina",
    email: "gina@example.com",
    firstName: "Gina",
    lastName: "Smith",
    displayName: "Gina",
    imageUrl: "https://api.dicebear.com/9.x/initials/svg?seed=Gina",
    provider: "mock"
  },
  {
    id: "mock-ed",
    email: "ed@example.com",
    firstName: "Ed",
    lastName: "Smith",
    displayName: "Ed",
    imageUrl: "https://api.dicebear.com/9.x/initials/svg?seed=Ed",
    provider: "mock"
  },
  {
    id: "mock-ayelet",
    email: "ayelet@example.com",
    firstName: "Ayelet",
    lastName: "Smith",
    displayName: "Ayelet",
    imageUrl: "https://api.dicebear.com/9.x/initials/svg?seed=Ayelet",
    provider: "mock"
  },
  {
    id: "mock-wolf",
    email: "wolf@example.com",
    firstName: "Wolf",
    lastName: "Smith",
    displayName: "Wolf",
    imageUrl: "https://api.dicebear.com/9.x/initials/svg?seed=Wolf",
    provider: "mock"
  }
];

export async function getCurrentUser(): Promise<CurrentUser> {
  const cookieStore = await cookies();
  const selectedEmail =
    cookieStore.get("mock_current_user")?.value ??
    process.env.MOCK_CURRENT_USER_EMAIL ??
    mockUsers[0].email;
  const mock = mockUsers.find((user) => user.email === selectedEmail) ?? mockUsers[0];

  const user = await prisma.user.upsert({
    where: { email: mock.email.toLowerCase() },
    update: {
      firstName: mock.firstName,
      lastName: mock.lastName,
      displayName: mock.displayName,
      imageUrl: mock.imageUrl,
      authProvider: "mock"
    },
    create: {
      email: mock.email.toLowerCase(),
      firstName: mock.firstName,
      lastName: mock.lastName,
      displayName: mock.displayName,
      imageUrl: mock.imageUrl,
      authProvider: "mock"
    }
  });

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName ?? user.firstName,
    imageUrl: user.imageUrl,
    provider: "mock"
  };
}
