import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MeldError } from "@melddb/core";
import { db } from "@/db";
import { projectMembers, projects, workspaceMembers } from "@/db/schema";
import { auth, type Session } from "@/lib/auth";

export type AppRole = "owner" | "admin" | "developer" | "viewer";

const roleRank: Record<AppRole, number> = { viewer: 0, developer: 1, admin: 2, owner: 3 };

export function hasMinimumRole(actual: AppRole, required: AppRole): boolean {
  return roleRank[actual] >= roleRank[required];
}

export function assertProjectMembership(
  memberships: ReadonlyArray<{ projectId: string; userId: string; role: AppRole }>,
  userId: string,
  projectId: string,
  required: AppRole = "viewer",
): AppRole {
  const membership = memberships.find((item) => item.userId === userId && item.projectId === projectId);
  if (!membership || !hasMinimumRole(membership.role, required)) {
    throw new MeldError({ code: "FORBIDDEN", message: "You do not have access to this project.", status: 403 });
  }
  return membership.role;
}

export async function getSession(requestHeaders?: Headers): Promise<Session | null> {
  return auth.api.getSession({ headers: requestHeaders ?? (await headers()) });
}

export async function requireSession(requestHeaders?: Headers): Promise<Session> {
  const session = await getSession(requestHeaders);
  if (!session) throw new MeldError({ code: "AUTHENTICATION_REQUIRED", message: "Sign in to continue.", status: 401 });
  return session;
}

export async function requirePageSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireProjectAccess(
  projectId: string,
  required: AppRole = "viewer",
  requestHeaders?: Headers,
): Promise<{ session: Session; project: typeof projects.$inferSelect; role: AppRole }> {
  const session = await requireSession(requestHeaders);
  const rows = await db
    .select({ project: projects, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, session.user.id)))
    .limit(1);
  const row = rows[0];
  if (!row || !hasMinimumRole(row.role, required)) {
    throw new MeldError({ code: "FORBIDDEN", message: "You do not have access to this project.", status: 403 });
  }
  return { session, project: row.project, role: row.role };
}

export async function requireWorkspaceAccess(
  workspaceId: string,
  required: AppRole = "viewer",
  requestHeaders?: Headers,
): Promise<{ session: Session; role: AppRole }> {
  const session = await requireSession(requestHeaders);
  const rows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, session.user.id)))
    .limit(1);
  const role = rows[0]?.role;
  if (!role || !hasMinimumRole(role, required)) {
    throw new MeldError({ code: "FORBIDDEN", message: "You do not have access to this workspace.", status: 403 });
  }
  return { session, role };
}
