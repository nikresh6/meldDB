import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { ProjectForm } from "@/components/product/project-form";
import { requirePageSession } from "@/lib/authorization";

export const metadata: Metadata = { title: "Create a project" };

export default async function OnboardingPage() {
  await requirePageSession();
  return <main className="onboarding-shell"><header><Logo href="/app" /><span>You own the databases. MeldDB connects them.</span></header><ProjectForm /></main>;
}
