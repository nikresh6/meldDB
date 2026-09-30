import { describe, expect, it } from "vitest";
import { assertProjectMembership, hasMinimumRole } from "./authorization";

const memberships = [
  { projectId: "project-a", userId: "user-a", role: "owner" as const },
  { projectId: "project-b", userId: "user-b", role: "developer" as const },
];

describe("tenant isolation", () => {
  it("allows the matching user and project", () => {
    expect(assertProjectMembership(memberships, "user-a", "project-a")).toBe("owner");
  });

  it("rejects user A from user B's project", () => {
    expect(() => assertProjectMembership(memberships, "user-a", "project-b")).toThrow("do not have access");
  });

  it("enforces role thresholds", () => {
    expect(hasMinimumRole("admin", "developer")).toBe(true);
    expect(() => assertProjectMembership(memberships, "user-b", "project-b", "admin")).toThrow("do not have access");
  });
});
