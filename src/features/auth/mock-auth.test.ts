import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { getMockIdentity } from "./mock-auth";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

describe("mock identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MOCK_CURRENT_USER_EMAIL;
  });

  it("uses a known selected cookie", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "ayelet@example.com" }) } as never);

    await expect(getMockIdentity()).resolves.toMatchObject({ email: "ayelet@example.com", displayName: "Ayelet" });
  });

  it("falls back safely when a cookie names an unknown user", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "attacker@example.com" }) } as never);

    await expect(getMockIdentity()).resolves.toMatchObject({ email: "gina@example.com", displayName: "Gina" });
  });

  it("uses the configured user when no cookie is present", async () => {
    process.env.MOCK_CURRENT_USER_EMAIL = " ED@EXAMPLE.COM ";
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);

    await expect(getMockIdentity()).resolves.toMatchObject({ email: "ed@example.com", displayName: "Ed" });
  });

  it("defaults to the first fixture when neither cookie nor environment selects a user", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);

    await expect(getMockIdentity()).resolves.toMatchObject({ email: "gina@example.com", displayName: "Gina" });
  });
});
