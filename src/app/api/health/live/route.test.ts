import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health/live", () => {
  it("reports process health without touching external dependencies", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "live" });
  });
});
