"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Database, KeyRound, Plus, RefreshCw, Search, Table2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface Column { name: string; type: string; nullable: boolean; primaryKey: boolean; ordinal: number }
interface LogicalTable { id: string; schema: string; name: string; primaryKeyColumn: string | null; columns: Column[] }
interface Resource { id: string; name: string; provider: string; dialect: string }

function inputValue(value: unknown) { return value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value); }

export function TableEditor({ projectId, tables, resources }: { projectId: string; tables: LogicalTable[]; resources: Resource[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(tables[0]?.id ?? null);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(Boolean(tables[0]));
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [rowOpen, setRowOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [sort, setSort] = useState<{ column: string; asc: boolean } | null>(null);
  const selected = tables.find((table) => table.id === selectedId) ?? null;
  const filteredTables = tables.filter((table) => `${table.schema}.${table.name}`.toLowerCase().includes(search.toLowerCase()));
  const shownRows = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => String(a[sort.column] ?? "").localeCompare(String(b[sort.column] ?? "")) * (sort.asc ? 1 : -1));
  }, [rows, sort]);

  const loadRows = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true); setError(null);
    const response = await fetch(`/api/projects/${projectId}/tables/${selectedId}/rows?limit=50&offset=${page * 50}`);
    const body = await response.json() as { data?: Array<Record<string, unknown>>; error?: { message?: string } };
    setLoading(false);
    if (!response.ok) { setError(body.error?.message ?? "Rows could not be loaded."); return; }
    setRows(body.data ?? []);
  }, [page, projectId, selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    fetch(`/api/projects/${projectId}/tables/${selectedId}/rows?limit=50&offset=${page * 50}`)
      .then(async (response) => {
        const body = await response.json() as { data?: Array<Record<string, unknown>>; error?: { message?: string } };
        if (!active) return;
        setLoading(false);
        if (!response.ok) { setError(body.error?.message ?? "Rows could not be loaded."); return; }
        setRows(body.data ?? []);
      })
      .catch(() => { if (active) { setLoading(false); setError("Rows could not be loaded."); } });
    return () => { active = false; };
  }, [page, projectId, selectedId]);

  async function saveRow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget);
    const values: Record<string, unknown> = {};
    for (const column of selected.columns) {
      const raw = String(form.get(column.name) ?? "");
      if (!raw && column.nullable) values[column.name] = null;
      else if (["integer", "bigint", "numeric"].includes(column.type)) values[column.name] = Number(raw);
      else if (column.type === "boolean") values[column.name] = raw === "true";
      else if (column.type === "json") { try { values[column.name] = JSON.stringify(JSON.parse(raw)); } catch { setError(`${column.name} must be valid JSON.`); return; } }
      else values[column.name] = raw;
    }
    const isEdit = Boolean(editing);
    const primaryKey = isEdit && selected.primaryKeyColumn ? editing?.[selected.primaryKeyColumn] : undefined;
    const response = await fetch(`/api/projects/${projectId}/tables/${selected.id}/rows`, { method: isEdit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isEdit ? { primaryKey, values } : values) });
    const body = await response.json() as { error?: { message?: string } };
    if (!response.ok) { setError(body.error?.message ?? "The row could not be saved."); return; }
    setRowOpen(false); setEditing(null); await loadRows();
  }

  async function deleteRow(row: Record<string, unknown>) {
    if (!selected?.primaryKeyColumn) return;
    const value = row[selected.primaryKeyColumn];
    if (!window.confirm(`Delete the row where ${selected.primaryKeyColumn} = ${String(value)}? This cannot be undone.`)) return;
    const response = await fetch(`/api/projects/${projectId}/tables/${selected.id}/rows`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ primaryKey: value, confirm: true }) });
    const body = await response.json() as { error?: { message?: string } };
    if (!response.ok) { setError(body.error?.message ?? "The row could not be deleted."); return; }
    await loadRows();
  }

  async function createTable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? ""); const resourceId = String(form.get("resourceId") ?? "");
    const response = await fetch(`/api/projects/${projectId}/tables`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, resourceId, columns: [{ name: "id", type: "uuid", nullable: false, primaryKey: true }, { name: "created_at", type: "timestamp", nullable: false, primaryKey: false }] }) });
    const body = await response.json() as { error?: { message?: string } };
    if (!response.ok) { setError(body.error?.message ?? "The table could not be created."); return; }
    setCreateOpen(false); router.refresh();
  }

  return <div className="editor-layout">
    <aside className="table-tree">
      <div className="tree-heading">
        <div><span>Tables</span><small>{tables.length}</small></div>
        <button disabled={!resources.length} onClick={() => setCreateOpen(true)} title="Create table"><Plus /></button>
      </div>
      <div className="tree-search"><label><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tables" /></label></div>
      <div className="tree-group">
        <small>PUBLIC SCHEMA</small>
        {filteredTables.map((table) => <button className={`tree-item ${table.id === selectedId ? "active" : ""}`} key={table.id} onClick={() => { setLoading(true); setError(null); setSelectedId(table.id); setPage(0); }}>
          <span className="tree-table-icon"><Table2 /></span>
          <span className="tree-table-name">{table.name}</span>
          <small>{table.columns.length}</small>
        </button>)}
        {tables.length === 0 && <div className="tree-empty">No tables yet. Attach a database and sync its schema, or create your first table.</div>}
        {tables.length > 0 && filteredTables.length === 0 && <div className="tree-empty">No tables match “{search}”.</div>}
      </div>
    </aside>
    <section className="editor-main">{selected ? <><div className="editor-toolbar">
      <div className="editor-title">
        <div><span className="editor-schema">{selected.schema}</span><strong>{selected.name}</strong></div>
        <small>{selected.columns.length} columns</small>
      </div>
      <span className="placement-chip"><i /> <Database /> {resources.length} connected node{resources.length === 1 ? "" : "s"}</span>
      <button className="product-button editor-refresh" onClick={() => void loadRows()}><RefreshCw /> Refresh</button>
      <button className="product-button primary" onClick={() => { setEditing(null); setRowOpen(true); }}><Plus /> Insert row</button>
    </div><div className="grid-area">{error && <div className="inline-error"><AlertTriangle />{error}</div>}{loading ? <div className="editor-loading"><span /> Loading rows…</div> : <table className="schema-grid"><thead><tr>{selected.columns.map((column) => <th key={column.name} onClick={() => setSort((current) => ({ column: column.name, asc: current?.column === column.name ? !current.asc : true }))}>{column.name}{column.primaryKey && <KeyRound />}<span>{column.type}{column.nullable ? " · nullable" : " · required"}</span></th>)}<th>Actions<span>row</span></th></tr></thead><tbody>{shownRows.map((row, index) => <tr key={index}>{selected.columns.map((column) => <td key={column.name} onDoubleClick={() => { setEditing(row); setRowOpen(true); }}>{row[column.name] === null ? <em>NULL</em> : inputValue(row[column.name])}</td>)}<td><button className="row-action" onClick={() => { setEditing(row); setRowOpen(true); }}>Edit</button><button className="row-action danger-text" onClick={() => void deleteRow(row)}><Trash2 /></button></td></tr>)}</tbody></table>}{!loading && !rows.length && !error && <div className="grid-empty"><div><span><Table2 /></span><strong>No rows yet</strong><p>This table is connected and ready. Add the first row when you are ready.</p><button className="product-button primary" onClick={() => { setEditing(null); setRowOpen(true); }}><Plus /> Insert row</button></div></div>}</div><div className="editor-statusbar"><span><b>{rows.length}</b> rows on this page</span><span>{selected.primaryKeyColumn ? `Primary key: ${selected.primaryKeyColumn}` : "Read-only until a primary key is configured"}</span><span><button disabled={page === 0} onClick={() => { setLoading(true); setPage((value) => value - 1); }}><ChevronLeft /></button><em>Page {page + 1}</em><button disabled={rows.length < 50} onClick={() => { setLoading(true); setPage((value) => value + 1); }}><ChevronRight /></button></span></div></> : <div className="capability-empty"><div className="empty-panel"><div><span className="empty-icon"><Table2 /></span><h2>Create a logical table</h2><p>Logical tables are backed by an explicit physical placement. Connect and attach a provider database first.</p><button className="product-button primary" disabled={!resources.length} onClick={() => setCreateOpen(true)}><Plus /> Create table</button></div></div></div>}</section>
    {createOpen && <div className="command-overlay" onMouseDown={() => setCreateOpen(false)}><form className="provider-modal" onSubmit={createTable} onMouseDown={(event) => event.stopPropagation()}><header><div><Table2 /><span><b>Create logical table</b><small>Creates a real physical table and catalog placement.</small></span></div><button type="button" onClick={() => setCreateOpen(false)}><X /></button></header><div className="modal-form"><label>Table name<input name="name" required pattern="[A-Za-z_][A-Za-z0-9_]*" placeholder="users" /></label><label>Initial placement<select name="resourceId" required>{resources.map((resource) => <option value={resource.id} key={resource.id}>{resource.name} · {resource.provider}</option>)}</select></label><div className="schema-seed"><code>id uuid PRIMARY KEY</code><code>created_at timestamp NOT NULL</code><p>Start safely with two canonical columns. Add columns from Schema after creation.</p></div></div>{error && <div className="form-error">{error}</div>}<footer><button type="button" className="product-button" onClick={() => setCreateOpen(false)}>Cancel</button><button className="product-button primary"><Plus /> Create table</button></footer></form></div>}
    {rowOpen && selected && <div className="command-overlay" onMouseDown={() => setRowOpen(false)}><form className="provider-modal row-modal" onSubmit={saveRow} onMouseDown={(event) => event.stopPropagation()}><header><div><Database /><span><b>{editing ? "Edit row" : "Insert row"}</b><small>{selected.schema}.{selected.name} · values are sent directly to the routed node.</small></span></div><button type="button" onClick={() => setRowOpen(false)}><X /></button></header><div className="modal-form">{selected.columns.map((column) => <label key={column.name}>{column.name}<span>{column.type}{column.primaryKey ? " · primary key" : ""}</span>{column.type === "boolean" ? <select name={column.name} defaultValue={inputValue(editing?.[column.name] ?? false)}><option value="false">false</option><option value="true">true</option></select> : <input name={column.name} defaultValue={inputValue(editing?.[column.name])} required={!column.nullable} readOnly={Boolean(editing && column.primaryKey)} placeholder={column.nullable ? "NULL when empty" : column.type} />}</label>)}</div>{error && <div className="form-error">{error}</div>}<footer><button type="button" className="product-button" onClick={() => setRowOpen(false)}>Cancel</button><button className="product-button primary">Save row</button></footer></form></div>}
  </div>;
}
