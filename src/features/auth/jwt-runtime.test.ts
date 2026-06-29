import { describe, expect, it } from "vitest";
import { decode, encode } from "next-auth/jwt";

describe("NextAuth JWT runtime", () => {
  it("encodes and decrypts a session with the patched UUID runtime", async () => {
    const secret = "test-session-secret-at-least-32-characters";
    const token = await encode({ token: { sub: "google-subject", email: "person@gmail.com" }, secret, maxAge: 60 });

    await expect(decode({ token, secret })).resolves.toMatchObject({
      sub: "google-subject",
      email: "person@gmail.com"
    });
  });
});
