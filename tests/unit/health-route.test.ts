import { describe, expect, it, vi } from "vitest";

// connection() needs a live Next.js request; outside one it is a no-op here.
vi.mock("next/server", () => ({ connection: async () => undefined }));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns ok, is not cached and exposes no configuration", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(Object.keys(body).sort()).toEqual(["service", "status", "time"]);
  });
});
