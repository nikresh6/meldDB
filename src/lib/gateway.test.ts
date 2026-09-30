import { describe, expect, it } from "vitest";
import { assertApiKeyProject } from "./gateway";

describe("API key tenant isolation", () => {
  it("rejects a Project A key at a Project B route before query planning", () => {
    expect(() => assertApiKeyProject("project-a", "project-b")).toThrow("does not belong");
  });

  it("accepts a key scoped to the requested project", () => {
    expect(() => assertApiKeyProject("project-a", "project-a")).not.toThrow();
  });
});
