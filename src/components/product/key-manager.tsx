"use client";

import { Check, Copy, KeyRound, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface KeyItem { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

export function KeyManager({ projectId, initialKeys }: { projectId: string; initialKeys: KeyItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(null);
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    const response = await fetch(`/api/projects/${projectId}/keys`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const body = (await response.json()) as { secret?: string; error?: { message?: string } };
    setPending(false);
    if (!response.ok || !body.secret) { setError(body.error?.message ?? "API key creation failed."); return; }
    setSecret(body.secret); router.refresh();
  }

  async function revoke(key: KeyItem) {
    if (!window.confirm(`Revoke “${key.name}”? Applications using ${key.prefix}… will stop working immediately.`)) return;
    await fetch(`/api/projects/${projectId}/keys?keyId=${encodeURIComponent(key.id)}`, { method: "DELETE" });
    router.refresh();
  }

  return <><div className="page-header"><div><h1>API Keys</h1><p>Project-scoped credentials for the MeldDB gateway. Raw keys are never stored.</p></div><div className="page-actions"><button className="product-button primary" onClick={() => { setOpen(true); setSecret(null); }}><Plus /> Create key</button></div></div><div className="panel"><div className="panel-header"><h2>Project keys</h2><span>{initialKeys.filter((key) => !key.revokedAt).length} active</span></div><table className="data-table"><thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr></thead><tbody>{initialKeys.map((key) => <tr key={key.id}><td>{key.name}</td><td><code>{key.prefix}••••••••</code></td><td>{new Date(key.createdAt).toLocaleDateString()}</td><td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}</td><td><span className={`state-badge ${key.revokedAt ? "" : "healthy"}`}><i />{key.revokedAt ? "Revoked" : "Active"}</span></td><td>{!key.revokedAt && <button className="product-button danger" onClick={() => revoke(key)}><Trash2 /> Revoke</button>}</td></tr>)}{initialKeys.length === 0 && <tr className="table-empty-row"><td colSpan={6}>No API keys. Create one to use the SDK or REST gateway.</td></tr>}</tbody></table></div>{open && <div className="command-overlay" onMouseDown={() => setOpen(false)}><form className="provider-modal" onSubmit={create} onMouseDown={(event) => event.stopPropagation()}><header><div><KeyRound /><span><b>{secret ? "Save this key now" : "Create API key"}</b><small>{secret ? "It will not be shown again." : "Keys are scoped to this project."}</small></span></div><button type="button" onClick={() => setOpen(false)}><X /></button></header>{secret ? <><div className="secret-reveal"><code>{secret}</code><button type="button" onClick={async () => { await navigator.clipboard.writeText(secret); setCopied(true); }}><>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</></button></div><div className="form-error safe-note">Store this value in a server-side secret manager. Never expose it through a NEXT_PUBLIC variable.</div></> : <><div className="field"><label htmlFor="key-name">Key name</label><input id="key-name" name="name" placeholder="Production API" required minLength={2} maxLength={120} autoFocus /></div>{error && <div className="form-error">{error}</div>}</>}<footer><button type="button" className="product-button" onClick={() => setOpen(false)}>{secret ? "Done" : "Cancel"}</button>{!secret && <button className="product-button primary" disabled={pending} type="submit">{pending ? <RotateCcw /> : <Plus />}{pending ? "Creating…" : "Create key"}</button>}</footer></form></div>}</>;
}
