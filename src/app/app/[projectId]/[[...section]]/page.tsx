import { Suspense } from "react";
import { AppShell } from "@/components/product/app-shell";
import { ProductPage } from "@/components/product/product-page";
import { requireProjectAccess } from "@/lib/authorization";
import { loadProjectData } from "@/lib/project-data";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string; section?: string[] }> }) {
  const { projectId, section: parts = [] } = await params;
  const { session, project } = await requireProjectAccess(projectId);
  const data = await loadProjectData(projectId);
  const section = parts.join("/") || "overview";
  return <Suspense fallback={<div className="app-loading">Loading MeldDB…</div>}><AppShell project={{ id: project.id, name: project.name, workspaceId: project.workspaceId }} user={{ name: session.user.name, email: session.user.email }}><ProductPage section={section} project={{ id: project.id, name: project.name, workspaceId: project.workspaceId, description: project.description }} data={data} /></AppShell></Suspense>;
}
