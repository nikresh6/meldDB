import { describe, expect, it } from "vitest";
import {
  capacityFromFallback,
  classifyUnifiedSql,
  decryptSecret,
  encryptSecret,
  generateApiKey,
  routeToShard,
  verifyApiKey,
} from "./index";

describe("stable routing", () => {
  it("is deterministic and independent of shard input ordering", () => {
    expect(routeToShard("user_123", ["shard-c", "shard-a", "shard-b"])).toBe(
      routeToShard("user_123", ["shard-a", "shard-b", "shard-c"]),
    );
  });

  it("rejects routing without a healthy placement", () => {
    expect(() => routeToShard("user_123", [])).toThrow("No healthy shard");
  });
});

describe("capacity", () => {
  it("treats a full provider as normal unavailable capacity", () => {
    const capacity = capacityFromFallback("supabase", 2);
    expect(capacity.canCreateResource).toBe(false);
    expect(capacity.actualResourcesRemaining).toBe(0);
    expect(capacity.unavailableReason).toContain("capacity reached");
  });

  it("uses the current Neon fallback without scattering it into UI code", () => {
    const capacity = capacityFromFallback("neon", 2);
    expect(capacity.knownFreeResourceLimit).toBe(20);
    expect(capacity.actualResourcesRemaining).toBe(18);
  });
});

describe("credential encryption", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  it("round trips with authenticated encryption", () => {
    const encrypted = encryptSecret("provider-secret", key, 4);
    expect(encrypted.ciphertext).not.toContain("provider-secret");
    expect(encrypted.version).toBe(4);
    expect(decryptSecret(encrypted, key)).toBe("provider-secret");
  });

  it("fails closed after tampering", () => {
    const encrypted = encryptSecret("provider-secret", key);
    expect(() => decryptSecret({ ...encrypted, ciphertext: `${encrypted.ciphertext}AA` }, key)).toThrow();
  });
});

describe("API keys", () => {
  it("shows the secret once while persisting only a verifier", () => {
    const apiKey = generateApiKey("a-server-side-pepper");
    expect(apiKey.secret).toMatch(/^mdb_live_/);
    expect(apiKey.hash).not.toContain(apiKey.secret);
    expect(verifyApiKey(apiKey.secret, apiKey.hash, "a-server-side-pepper")).toBe(true);
    expect(verifyApiKey(`${apiKey.secret}x`, apiKey.hash, "a-server-side-pepper")).toBe(false);
  });
});

describe("Unified SQL classification", () => {
  it("classifies the supported single-table subset", () => {
    expect(classifyUnifiedSql("SELECT id, email FROM users WHERE id = $1 ORDER BY id LIMIT 20")).toMatchObject({
      operation: "select",
      table: "users",
      isWrite: false,
    });
    expect(classifyUnifiedSql("UPDATE users SET email = $1 WHERE id = $2")).toMatchObject({
      operation: "update",
      isWrite: true,
    });
  });

  it("rejects cross-table joins with an actionable explanation", () => {
    expect(() =>
      classifyUnifiedSql("SELECT * FROM users JOIN orders ON users.id = orders.user_id"),
    ).toThrow("cross-provider join");
  });

  it("rejects DDL rather than silently issuing it", () => {
    expect(() => classifyUnifiedSql("DROP TABLE users")).toThrow("supports SELECT, INSERT, UPDATE, and DELETE");
  });
});
