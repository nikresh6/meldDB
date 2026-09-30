"use client";

import { AlertTriangle, RefreshCw, Save, Shield } from "lucide-react";
import { useEffect, useState } from "react";

interface AuthConfig { disable_signup?: boolean; external_anonymous_users_enabled?: boolean; site_url?: string; uri_allow_list?: string; jwt_exp?: number; password_min_length?: number; mailer_autoconfirm?: boolean }

export function AuthManager({ projectId, resourceName }: { projectId: string; resourceName: string }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);

  async function load() {
    setPending(true); setError(null); const response = await fetch(`/api/projects/${projectId}/supabase/auth`); const body = await response.json() as { data?: AuthConfig; error?: { message?: string } }; setPending(false);
    if (!response.ok) { setError(body.error?.message ?? "Auth configuration could not be read."); return; } setConfig(body.data ?? {});
  }
  useEffect(() => { fetch(`/api/projects/${projectId}/supabase/auth`).then(async (response) => ({ response, body: await response.json() as { data?: AuthConfig; error?: { message?: string } } })).then(({ response, body }) => { setPending(false); if (!response.ok) setError(body.error?.message ?? "Auth configuration could not be read."); else setConfig(body.data ?? {}); }).catch(() => { setPending(false); setError("Auth configuration could not be read."); }); }, [projectId]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setPending(true); setError(null);
    const payload = { disable_signup: form.get("signup") !== "on", external_anonymous_users_enabled: form.get("anonymous") === "on", mailer_autoconfirm: form.get("autoconfirm") === "on", site_url: String(form.get("siteUrl") ?? ""), uri_allow_list: String(form.get("redirects") ?? ""), jwt_exp: Number(form.get("jwtExp")), password_min_length: Number(form.get("passwordMin")) };
    const response = await fetch(`/api/projects/${projectId}/supabase/auth`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const body = await response.json() as { data?: AuthConfig; error?: { message?: string } }; setPending(false);
    if (!response.ok) { setError(body.error?.message ?? "Auth configuration could not be saved."); return; } setConfig(body.data ?? payload);
  }

  if (pending && !config) return <div className="editor-loading"><span /> Reading Supabase Auth configuration…</div>;
  if (error && !config) return <div className="query-error"><AlertTriangle /><div><strong>Auth configuration unavailable</strong><p>{error}</p><button className="product-button" onClick={() => void load()}><RefreshCw /> Retry</button></div></div>;
  return <form className="auth-manager" onSubmit={save}><div className="capability-summary"><Shield /><div><h3>Backed by {resourceName}</h3><p>Only supported, non-secret settings are displayed. Secret provider fields remain write-only.</p></div></div><div className="auth-settings-grid"><label><span>Site URL<small>Primary redirect origin</small></span><input name="siteUrl" type="url" required defaultValue={config?.site_url ?? "http://localhost:3000"} /></label><label><span>Redirect allow list<small>Comma-separated URLs</small></span><input name="redirects" defaultValue={config?.uri_allow_list ?? ""} /></label><label><span>JWT lifetime<small>Seconds, 300–604800</small></span><input name="jwtExp" type="number" min={300} max={604800} defaultValue={config?.jwt_exp ?? 3600} /></label><label><span>Minimum password length<small>6–72 characters</small></span><input name="passwordMin" type="number" min={6} max={72} defaultValue={config?.password_min_length ?? 8} /></label><label className="check-setting"><span>Email/password signups<small>Allow new user registration</small></span><input name="signup" type="checkbox" defaultChecked={!config?.disable_signup} /></label><label className="check-setting"><span>Anonymous users<small>Provider capability permitting</small></span><input name="anonymous" type="checkbox" defaultChecked={config?.external_anonymous_users_enabled} /></label><label className="check-setting"><span>Email auto-confirm<small>Use with care outside development</small></span><input name="autoconfirm" type="checkbox" defaultChecked={config?.mailer_autoconfirm} /></label></div>{error && <div className="form-error">{error}</div>}<footer><span>Changes apply directly to Supabase.</span><button className="product-button primary" disabled={pending}><Save /> {pending ? "Saving…" : "Save configuration"}</button></footer></form>;
}
