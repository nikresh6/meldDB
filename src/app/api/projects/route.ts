import { generateApiKey, MeldError } from "@melddb/core";
import { z } from "zod";
import { db } from "@/db";
import { apiKeys, projectMembers, projects, workspaceMembers, workspaces } from "@/db/schema";
import { requireSession } from "@/lib/authorization";
import { errorResponse, requestId } from "@/lib/http";

const createProjectInput = z.object({
  name: z.string().trim().min(2).max(120),
  workspaceName: z.string().trim().min(2).max(120).optional(),
  regionPreference: z.string().trim().max(64).optional(),
});

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${base || "project"}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function POST(request: Request) {
  const id = requestId(request);
  try {
    const session = await requireSession(request.headers);
    const input = createProjectInput.parse(await request.json());
    const pepper = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!pepper) {
      throw new MeldError({
        code: "CONFIGURATION_REQUIRED",
        message: "CREDENTIAL_ENCRYPTION_KEY is required before projects can issue API keys.",
        status: 503,
      });
    }
    const generated = generateApiKey(pepper);

    const created = await db.transaction(async (tx) => {
      const workspace = (
        await tx
          .insert(workspaces)
          .values({ name: input.workspaceName ?? `${input.name} workspace`, slug: slugify(input.workspaceName ?? input.name) })
          .returning()
      )[0];
      if (!workspace) throw new Error("Workspace was not created.");
      await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: session.user.id, role: "owner" });

      const project = (
        await tx
          .insert(projects)
          .values({
            workspaceId: workspace.id,
            name: input.name,
            slug: slugify(input.name),
            regionPreference: input.regionPreference,
          })
          .returning()
      )[0];
      if (!project) throw new Error("Project was not created.");
      await tx.insert(projectMembers).values({ projectId: project.id, userId: session.user.id, role: "owner" });
      await tx.insert(apiKeys).values({
        projectId: project.id,
        name: "Default key",
        prefix: generated.prefix,
        secretHash: generated.hash,
      });
      return { project, workspace };
    });

    return Response.json(
      { project: created.project, workspace: created.workspace, apiKey: generated.secret },
      { status: 201, headers: { "x-request-id": id } },
    );
  } catch (error) {
    return errorResponse(error, id);
  }
}
