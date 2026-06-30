import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafe = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafe
  }
}));

import { GET } from "./route";

describe("GET /api/health/ready", () => {
  beforeEach(() => {
    queryRawUnsafe.mockReset();
  });

  it("reports readiness when PostgreSQL responds", async () => {
    queryRawUnsafe.mockResolvedValue([{ "?column?": 1 }]);

    const response = await GET();

    expect(queryRawUnsafe).toHaveBeenCalledWith("SELECT 1");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ready" });
  });

  it("returns a sanitized unavailable response when PostgreSQL fails", async () => {
    queryRawUnsafe.mockRejectedValue(new Error("connection details must not leak"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "not_ready" });
  });
});
