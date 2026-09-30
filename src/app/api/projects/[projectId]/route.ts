import { eq } from "drizzle-orm";
import { MeldError } from "@melddb/core";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, projects } from "@/db/schema";
import { requireProjectAccess } from "@/lib/authorization";
import { errorResponse, requestId } from "@/lib/http";

type Context = { params: Promise<{ projectId: string }> };

export async function DELETE(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params;
    const { project, session } = await requireProjectAccess(projectId, "owner", request.headers);
    const input = z.object({ confirmation: z.string().max(120), preserveProviderResources: z.literal(true) }).parse(await request.json());
    if (input.confirmation !== project.name) throw new MeldError({ code: "INVALID_INPUT", message: `Type ${project.name} exactly to delete this MeldDB project.`, status: 400 });
    await db.transaction(async (transaction) => {
      await transaction.delete(projects).where(eq(projects.id, projectId));
      await transaction.insert(auditEvents).values({ workspaceId: project.workspaceId, actorUserId: session.user.id, action: "project.deleted", targetType: "project", targetId: projectId, outcome: "success", requestId: id, safeMetadata: { providerResourcesPreserved: true } });
    });
    return Response.json({ data: { deleted: true, providerResourcesPreserved: true }, meta: { requestId: id } });
  } catch (error) { return errorResponse(error, id); }
}
