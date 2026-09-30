"use client";

import dynamic from "next/dynamic";
import { AlertTriangle, Check, Clock3, Play, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="editor-loading"><span /> Loading SQL engine…</div>,
});

interface SqlResource { id: string; name: string; provider: string; dialect: string }
interface SqlMeta { rowCount?: number; durationMs?: number; requestId?: string; providers?: string[]; provider?: string; dialect?: string }

export function SqlEditor({ projectId, resources, tableNames }: { projectId: string; resources: SqlResource[]; tableNames: string[] }) {
  const sampleTable = tableNames[0] ?? "your_table";
  const [sql, setSql] = useState(`SELECT *\nFROM ${sampleTable}\nLIMIT 100;`);
  const [target, setTarget] = useState("unified");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [meta, setMeta] = useState<SqlMeta | null>(null);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);
  const columns = useMemo(() => [...new Set(rows.flatMap((row) => Object.keys(row)))], [rows]);

  const run = useCallback(async (confirmDestructive = false) => {
    if (!sql.trim() || running) return;
    setRunning(true); setError(null); setConfirming(false);
    const response = await fetch(`/api/projects/${projectId}/sql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, target, params: [], confirmDestructive }),
    });
    const body = (await response.json()) as { data?: Array<Record<string, unknown>>; meta?: SqlMeta; error?: { message?: string; requestId?: string } };
    setRunning(false);
    if (!response.ok) {
      const message = body.error?.message ?? "The query could not be executed.";
      setError({ message, requestId: body.error?.requestId });
      if (response.status === 409 && message.toLowerCase().includes("confirmation")) setConfirming(true);
      return;
    }
    setRows(body.data ?? []); setMeta(body.meta ?? null);
    try {
      const history = JSON.parse(localStorage.getItem(`melddb:sql:${projectId}`) ?? "[]") as unknown[];
      localStorage.setItem(`melddb:sql:${projectId}`, JSON.stringify([{ sql, target, at: new Date().toISOString() }, ...history].slice(0, 20)));
    } catch { /* Local history is optional and bounded. */ }
  }, [projectId, running, sql, target]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void run(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [run]);

  async function saveQuery() {
    const title = window.prompt("Name this query", "Untitled query");
    if (!title) return;
    const response = await fetch(`/api/projects/${projectId}/queries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, sql, target }) });
    if (!response.ok) { const body = await response.json() as { error?: { message?: string } }; setError({ message: body.error?.message ?? "The query could not be saved." }); return; }
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  return <div className="sql-workspace">
    <div className="sql-tabs"><button className="sql-tab"><i /> Query 1</button></div>
    <section className="sql-pane">
      <div className="sql-toolbar">
        <select className="sql-target" aria-label="Query target" value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="unified">Unified · portable subset</option>
          {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name} · {resource.provider} · {resource.dialect}</option>)}
        </select>
        <span className="sql-safety">{target === "unified" ? "AST-routed" : "Physical SQL"}</span>
        <button className="product-button" onClick={() => void saveQuery()}>{saved ? <Check /> : <Save />} {saved ? "Saved" : "Save"}</button>
        <button className="product-button primary run" disabled={running} onClick={() => void run()}><Play /> {running ? "Running…" : "Run"} <kbd>⌘↵</kbd></button>
      </div>
      <MonacoEditor
        height="calc(100% - 43px)"
        language="sql"
        theme="vs-dark"
        value={sql}
        onChange={(value) => setSql(value ?? "")}
        options={{ minimap: { enabled: false }, fontFamily: "var(--mono)", fontSize: 13, lineHeight: 22, padding: { top: 14 }, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "on" }}
      />
    </section>
    <section className="results-pane">
      <div className="results-tabs"><b>Results</b>{meta && <><span>{meta.rowCount ?? rows.length} rows</span><span><Clock3 /> {meta.durationMs ?? 0} ms</span><span>{meta.providers?.join(", ") ?? meta.provider}</span></>}</div>
      <div className="results-body">
        {error ? <div className="query-error"><AlertTriangle /><div><strong>Query failed</strong><p>{error.message}</p>{error.requestId && <code>Request {error.requestId}</code>}{confirming && <button className="product-button danger" onClick={() => void run(true)}>I understand — run destructive query</button>}</div></div>
          : rows.length ? <table className="schema-grid"><thead><tr>{columns.map((column) => <th key={column}>{column}<span>result</span></th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{row[column] === null ? <em>NULL</em> : typeof row[column] === "object" ? JSON.stringify(row[column]) : String(row[column] ?? "")}</td>)}</tr>)}</tbody></table>
          : meta ? <div className="query-success"><Check /><div><strong>Query completed</strong><p>No rows were returned.</p></div></div>
          : <div className="grid-empty">Run a query to see ephemeral results. Result sets are never stored in MeldDB.</div>}
      </div>
    </section>
  </div>;
}
