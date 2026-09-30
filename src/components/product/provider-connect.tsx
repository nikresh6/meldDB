"use client";

import { Check, Database, ExternalLink, KeyRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Provider = "supabase" | "neon" | "cloudflare-d1";

export function ProviderConnect({ provider, projectId, workspaceId, connected, configured }: { provider: Provider; projectId: string; workspaceId: string; connected: boolean; configured: boolean }) {
  const router = useRouter();
  const [neonOpen, setNeonOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const name = provider === "cloudflare-d1" ? "Cloudflare D1" : provider[0]?.toUpperCase() + provider.slice(1);
  const oauthPath = provider === "supabase" ? "supabase" : "cloudflare";
  const href = `/api/providers/${oauthPath}/start?workspaceId=${encodeURIComponent(workspaceId)}&returnTo=${encodeURIComponent(`/app/${projectId}/infrastructure/nodes`)}`;

  async function connectNeon(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(null);
    const apiKey = String(new FormData(event.currentTarget).get("apiKey") ?? "");
    const response = await fetch("/api/providers/neon/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, apiKey }) });
    const body = (await response.json()) as { error?: { message?: string } };
    setPending(false);
    if (!response.ok) { setError(body.error?.message ?? "Neon connection failed."); return; }
    setNeonOpen(false); router.refresh();
  }

  async function selectCloudflareAccount() {
    setPending(true); setError(null);
    const response = await fetch(`/api/providers/cloudflare/accounts?workspaceId=${encodeURIComponent(workspaceId)}`);
    const body = await response.json() as { data?: Array<{ id: string; name: string }>; error?: { message?: string } };
    setPending(false);
    if (!response.ok) { setError(body.error?.message ?? "Cloudflare accounts could not be loaded."); return; }
    setAccounts(body.data ?? []); setNeonOpen(true);
  }

  async function chooseAccount(accountId: string) {
    setPending(true); const response = await fetch("/api/providers/cloudflare/accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, accountId }) }); setPending(false);
    if (!response.ok) { const body = await response.json() as { error?: { message?: string } }; setError(body.error?.message ?? "Account selection failed."); return; }
    setNeonOpen(false); router.refresh();
  }

  if (connected && provider !== "cloudflare-d1") return <span className="state-badge healthy"><i /> Connected</span>;
  if (connected && provider === "cloudflare-d1") return <><button className="product-button" disabled={pending} onClick={() => void selectCloudflareAccount()}>{pending ? "Loading…" : "Select account"}</button>{neonOpen && <div className="command-overlay" onMouseDown={() => setNeonOpen(false)}><div className="provider-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><Database /><span><b>Select Cloudflare account</b><small>D1 resources will be scoped to this account.</small></span></div><button onClick={() => setNeonOpen(false)}><X /></button></header><div className="resource-modal-body"><div className="remote-resources">{accounts.map((account) => <button key={account.id} disabled={pending} onClick={() => void chooseAccount(account.id)}><span><b>{account.name}</b><small>{account.id}</small></span><Check /></button>)}{!accounts.length && <p>No Cloudflare account is available to the granted token.</p>}</div>{error && <div className="form-error">{error}</div>}</div><footer><button className="product-button" onClick={() => setNeonOpen(false)}>Cancel</button></footer></div></div>}</>;
  if (provider !== "neon" && !configured) return <button className="product-button" disabled title={`${name} OAuth owner credentials must be added to the deployment environment.`}>Configuration required</button>;

  return <>{provider === "neon" ? <button className="product-button" onClick={() => setNeonOpen(true)}><KeyRound /> Connect</button> : <a className="product-button" href={href}><ExternalLink /> Connect</a>}{neonOpen && <div className="command-overlay" onMouseDown={() => setNeonOpen(false)}><form className="provider-modal" onSubmit={connectNeon} onMouseDown={(event) => event.stopPropagation()}><header><div><Database /><span><b>Connect Neon</b><small>Paste an API key once. It is validated, then encrypted.</small></span></div><button type="button" onClick={() => setNeonOpen(false)}><X /></button></header><div className="field"><label htmlFor="neon-key">Neon API key</label><input id="neon-key" name="apiKey" type="password" autoComplete="off" minLength={20} required placeholder="napi_••••••••••••••••" /></div><p>Create a scoped key in Neon Developer Settings. MeldDB never logs or displays it after submission.</p>{error && <div className="form-error">{error}</div>}<footer><button type="button" className="product-button" onClick={() => setNeonOpen(false)}>Cancel</button><button className="product-button primary" disabled={pending} type="submit">{pending ? "Validating…" : <><Check /> Validate and connect</>}</button></footer></form></div>}</>;
}
