import { describe, expect, it, vi } from "vitest";
import { createMeldDB } from "./index";

describe("MeldDB SDK", () => {
  it("builds parameterized queries without concatenating values", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const client = createMeldDB({ apiKey: "mdb_test_example", projectId: "project-a", baseUrl: "http://localhost:3000", fetch: fetcher });
    await client.from("users").select("id,email").eq("email", "person@example.com' OR 1=1 --").limit(20);
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { sql: string; params: string[] };
    expect(body.sql).toContain('"email" = $1');
    expect(body.sql).not.toContain("person@example.com");
    expect(body.params).toEqual(["person@example.com' OR 1=1 --"]);
  });

  it("rejects unsafe identifiers locally", async () => {
    const client = createMeldDB({ apiKey: "key", projectId: "project" });
    await expect(client.from("users; drop table users").select().execute()).rejects.toThrow("Invalid identifier");
  });
});
