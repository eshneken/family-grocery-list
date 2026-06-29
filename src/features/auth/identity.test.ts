import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationRequiredError } from "./errors";
import { getGoogleSession } from "./google-auth";
import { isMockAuthEnabled } from "./mode";
import { getMockIdentity } from "./mock-auth";
import { getAuthenticatedIdentity } from "./identity";

vi.mock("./google-auth", () => ({ getGoogleSession: vi.fn() }));
vi.mock("./mode", () => ({ isMockAuthEnabled: vi.fn() }));
vi.mock("./mock-auth", () => ({ getMockIdentity: vi.fn() }));

describe("provider-neutral identity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to the mock provider only in mock mode", async () => {
    vi.mocked(isMockAuthEnabled).mockReturnValue(true);
    vi.mocked(getMockIdentity).mockResolvedValue({
      email: "mock@example.com",
      displayName: "Mock",
      imageUrl: null,
      provider: "mock"
    });

    await expect(getAuthenticatedIdentity()).resolves.toMatchObject({ email: "mock@example.com", provider: "mock" });
    expect(getGoogleSession).not.toHaveBeenCalled();
  });

  it("normalizes a valid Google session", async () => {
    vi.mocked(isMockAuthEnabled).mockReturnValue(false);
    vi.mocked(getGoogleSession).mockResolvedValue({
      user: { email: " Person@Gmail.COM ", name: "Person", image: "https://example.com/person.png" },
      expires: new Date(Date.now() + 60_000).toISOString()
    });

    await expect(getAuthenticatedIdentity()).resolves.toEqual({
      email: "person@gmail.com",
      displayName: "Person",
      imageUrl: "https://example.com/person.png",
      provider: "google"
    });
  });

  it("rejects missing or malformed Google session emails", async () => {
    vi.mocked(isMockAuthEnabled).mockReturnValue(false);
    vi.mocked(getGoogleSession).mockResolvedValue(null);
    await expect(getAuthenticatedIdentity()).rejects.toBeInstanceOf(AuthenticationRequiredError);

    vi.mocked(getGoogleSession).mockResolvedValue({
      user: { email: "not-an-email" },
      expires: new Date(Date.now() + 60_000).toISOString()
    });
    await expect(getAuthenticatedIdentity()).rejects.toBeInstanceOf(AuthenticationRequiredError);
  });

  it("derives a display name and null image when optional Google session fields are absent", async () => {
    vi.mocked(isMockAuthEnabled).mockReturnValue(false);
    vi.mocked(getGoogleSession).mockResolvedValue({
      user: { email: "fallback@gmail.com" },
      expires: new Date(Date.now() + 60_000).toISOString()
    });

    await expect(getAuthenticatedIdentity()).resolves.toMatchObject({
      displayName: "fallback",
      imageUrl: null
    });
  });
});
