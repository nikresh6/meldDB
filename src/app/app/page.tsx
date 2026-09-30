import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { projectMembers, projects } from "@/db/schema";
import { requirePageSession } from "@/lib/authorization";

export default async function AppEntryPage() {
  const session = await requirePageSession();
  const rows = await db.select({ id: projects.id }).from(projectMembers).innerJoin(projects, eq(projectMembers.projectId, projects.id)).where(eq(projectMembers.userId, session.user.id)).limit(1);
  if (!rows[0]) redirect("/onboarding");
  redirect(`/app/${rows[0].id}/overview`);
}
