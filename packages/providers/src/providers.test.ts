import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareD1Adapter, toD1Parameters } from "./cloudflare-d1";
import { createTableSql } from "./schema-sql";

afterEach(() => vi.unstubAllGlobals());

describe("provider normalization", () => {
  it("converts numbered parameters without touching quoted SQL", () => {
    expect(toD1Parameters(`select '$1', "col$2" from users where id = $2 and active = $1`, [true, "abc"])).toEqual({
      sql: `select '$1', "col$2" from users where id = ? and active = ?`,
      params: ["abc", true],
    });
  });
  it("normalizes D1 resources and account capacity without inventing metrics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            result: [
              { uuid: "d1-1", name: "events", file_size: 2048, created_at: "2026-01-01T00:00:00Z" },
              { uuid: "d1-2", name: "sessions", file_size: 1024, created_at: "2026-01-02T00:00:00Z" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const adapter = new CloudflareD1Adapter("secret-token", "account-1");
    const capacity = await adapter.getAccountCapacity();
    expect(capacity.actualResourcesUsed).toBe(2);
    expect(capacity.actualResourcesRemaining).toBe(8);
    expect(capacity.accountStorageUsedBytes).toBe(3072);
    expect(capacity.source).toBe("known_limit");
  });

  it("preserves provider permission failures as actionable errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, errors: [{ message: "D1 permission denied" }] }), {
          status: 403,
          headers: { "content-type": "application/json", "cf-ray": "ray-123" },
        }),
      ),
    );

    const adapter = new CloudflareD1Adapter("expired-token", "account-1");
    await expect(adapter.listResources()).rejects.toMatchObject({
      code: "PERMISSION_MISSING",
      provider: "cloudflare-d1",
      requestId: "ray-123",
    });
  });
});

describe("schema SQL", () => {
  it("maps canonical logical types to SQLite storage classes", () => {
    expect(createTableSql({ schema: null, name: "events", rowCount: null, columns: [
      { name: "id", dataType: "uuid", nullable: false, primaryKey: true, defaultValue: null },
      { name: "created_at", dataType: "timestamp", nullable: false, primaryKey: false, defaultValue: null },
    ] }, "sqlite")).toBe('CREATE TABLE "events" ("id" text PRIMARY KEY NOT NULL, "created_at" text NOT NULL)');
  });
  it("uses a strict type allowlist and quoted identifiers", () => {
    expect(
      createTableSql(
        {
          schema: "public",
          name: "user events",
          rowCount: null,
          columns: [
            { name: "id", dataType: "uuid", nullable: false, primaryKey: true, defaultValue: null },
            { name: "payload", dataType: "jsonb", nullable: true, primaryKey: false, defaultValue: null },
          ],
        },
        "postgresql",
      ),
    ).toBe('CREATE TABLE "public"."user events" ("id" uuid PRIMARY KEY NOT NULL, "payload" jsonb)');
  });

  it("rejects arbitrary type fragments", () => {
    expect(() =>
      createTableSql(
        {
          schema: "main",
          name: "events",
          rowCount: null,
          columns: [
            {
              name: "payload",
              dataType: "TEXT); DROP TABLE users; --",
              nullable: true,
              primaryKey: false,
              defaultValue: null,
            },
          ],
        },
        "sqlite",
      ),
    ).toThrow("not an allowed sqlite type");
  });
});
