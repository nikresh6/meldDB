"use client";

import { Check, Database, LoaderCircle, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface RemoteResource { externalId: string; name: string; region: string | null; dialect: string }
interface Capacity { actualResourcesUsed: number | null; knownFreeResourceLimit: number | null; actualResourcesRemaining: number | null; canCreateResource: boolean; unavailableReason?: string }

export function ResourceManager({ projectId, provider, hasAttached }: { projectId: string; provider: string; hasAttached: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resources, setResources] = useState<RemoteResource[]>([]);
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/projects/${projectId}/providers/${provider}/resources`)
      .then(async (response) => {
        const body = await response.json() as { data?: RemoteResource[]; capacity?: Capacity; attachedExternalIds?: string[]; error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? "Provider resources could not be loaded.");
        setResources(body.data ?? []); setCapacity(body.capacity ?? null); setAttachedIds(body.attachedExternalIds ?? []);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Provider resources could not be loaded."))
      .finally(() => setLoading(false));
  }, [open, projectId, provider]);

  async function provision(body: Record<string, unknown>) {
    setSaving(true); setError(null);
    const response = await fetch(`/api/projects/${projectId}/providers/${provider}/resources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: { message?: string } }; setSaving(false);
    if (!response.ok) { setError(result.error?.message ?? "Provisioning failed."); return; }
    setOpen(false); router.refresh();
  }

  async function disconnect(resource: RemoteResource) {
    const confirmation = window.prompt(`Type ${resource.name} to disconnect it from MeldDB. The provider database will be preserved.`);
    if (confirmation !== resource.name) return;
    setSaving(true); setError(null);
    const response = await fetch(`/api/projects/${projectId}/providers/${provider}/resources`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ externalId: resource.externalId, confirmation, preserveProviderResource: true }) });
    const body = await response.json() as { error?: { message?: string } }; setSaving(false);
    if (!response.ok) { setError(body.error?.message ?? "Disconnect failed."); return; }
    setAttachedIds((current) => current.filter((value) => value !== resource.externalId)); router.refresh();
  }

  return <><button className="product-button" onClick={() => { setLoading(true); setError(null); setOpen(true); }}>{hasAttached ? <><RefreshCw /> Manage</> : <><Plus /> Add database</>}</button>{open && <div className="command-overlay" onMouseDown={() => setOpen(false)}><div className="provider-modal resource-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><Database /><span><b>Manage {provider === "cloudflare-d1" ? "Cloudflare D1" : provider}</b><small>Attach or create resources. Disconnecting preserves provider infrastructure.</small></span></div><button onClick={() => setOpen(false)}><X /></button></header>{loading ? <div className="modal-loading"><LoaderCircle /> Refreshing resources, capacity, storage, and health…</div> : <div className="resource-modal-body">{capacity && <div className="capacity-callout"><span>{capacity.actualResourcesUsed ?? "?"} / {capacity.knownFreeResourceLimit ?? "?"} resources used</span><strong>{capacity.actualResourcesRemaining ?? "Unknown"} remaining</strong>{!capacity.canCreateResource && <p>{capacity.unavailableReason}</p>}</div>}<div className="remote-resources"><small>PROVIDER RESOURCES</small>{resources.map((resource) => { const attached = attachedIds.includes(resource.externalId); return <div className="remote-resource-row" key={resource.externalId}><span><b>{resource.name}</b><small>{resource.region ?? "Global"} · {resource.dialect}</small></span>{attached ? <button className="danger-text" disabled={saving} onClick={() => void disconnect(resource)}><Trash2 /> Disconnect</button> : <button disabled={saving} onClick={() => void provision({ action: "attach", externalId: resource.externalId })}><Check /> Attach</button>}</div>; })}{resources.length === 0 && <p>No resources were returned by this provider.</p>}</div><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void provision({ action: "create", name: String(data.get("name")), region: String(data.get("region") || "") || undefined }); }}><small>CREATE NEW</small><div className="inline-fields"><input name="name" required minLength={2} maxLength={120} placeholder="melddb-production" /><input name="region" placeholder="Region (optional)" /><button className="product-button primary" disabled={saving || capacity?.canCreateResource === false}>{saving ? "Working…" : "Create"}</button></div></form>{error && <div className="form-error">{error}</div>}</div>}<footer><button className="product-button" onClick={() => setOpen(false)}>Close</button></footer></div></div>}</>;
}
