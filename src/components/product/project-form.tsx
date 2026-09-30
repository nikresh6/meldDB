"use client";

import { Check, Copy, Database, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface CreatedProject {
  project: { id: string; name: string };
  workspace: { id: string; name: string };
  apiKey: string;
}

export function ProjectForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedProject | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), regionPreference: form.get("region") || undefined }) });
    const body = (await response.json()) as CreatedProject & { error?: { message?: string } };
    setPending(false);
    if (!response.ok) { setError(body.error?.message ?? "Project creation failed."); return; }
    setCreated(body);
  }

  async function copyKey() { if (!created) return; await navigator.clipboard.writeText(created.apiKey); setCopied(true); setTimeout(() => setCopied(false), 1800); }

  if (created) return (
    <div className="onboarding-card key-reveal"><div className="success-mark"><Check /></div><h1>Your MeldDB project is ready.</h1><p>This key is shown once. Store it in your application&apos;s secret manager; MeldDB keeps only its one-way verifier.</p><div className="secret-reveal"><code>{created.apiKey}</code><button onClick={copyKey} type="button">{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</button></div><div className="form-error safe-note">Do not put this key in browser code, screenshots, or Git history.</div><button className="form-button" onClick={() => router.push(`/app/${created.project.id}/overview`)} type="button">Open {created.project.name} <ExternalLink /></button></div>
  );

  return (
    <form className="onboarding-card" onSubmit={submit}>
      <div className="onboarding-step">STEP 1 OF 4</div><div className="onboarding-icon"><Database /></div><h1>Create your first project</h1><p>A MeldDB project is a logical backend. You can connect one provider, all three, or skip infrastructure until later.</p>
      <div className="field"><label htmlFor="project-name">Project name</label><input id="project-name" name="name" placeholder="Northstar" required minLength={2} maxLength={120} autoFocus /></div>
      <div className="field"><label htmlFor="region">Preferred region <span>optional</span></label><select id="region" name="region" defaultValue=""><option value="">No preference</option><option value="us-east">US East</option><option value="us-west">US West</option><option value="eu-central">Europe Central</option><option value="ap-southeast">Asia Pacific</option></select></div>
      {error && <div className="form-error" role="alert">{error}</div>}<button className="form-button" disabled={pending} type="submit">{pending ? "Creating control plane…" : "Create project"}</button><p className="onboarding-footnote">No provider resources are created in this step.</p>
    </form>
  );
}
