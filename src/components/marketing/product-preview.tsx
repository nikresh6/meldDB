import { Check, ChevronDown, Columns3, Database, Play, Search } from "lucide-react";

const rows = [
  ["usr_8f21", "ada@northstar.dev", "active", "Sep 28, 2026"],
  ["usr_17c4", "lin@aperture.io", "active", "Sep 27, 2026"],
  ["usr_42aa", "sam@vector.tools", "invited", "Sep 26, 2026"],
] as const;

export function ProductPreview() {
  return (
    <div className="product-preview" aria-label="Simulated MeldDB table editor product preview">
      <div className="preview-caption">Product preview · simulated demonstration data</div>
      <div className="preview-frame">
        <aside>
          <div className="preview-brand"><span className="mark-mini" /> MeldDB</div>
          <div className="preview-project">northstar / production <ChevronDown size={12} /></div>
          <small>DATABASE</small>
          <div className="preview-nav active"><Columns3 size={13} /> Table Editor</div>
          <div className="preview-nav"><Database size={13} /> SQL Editor</div>
        </aside>
        <main>
          <header>
            <div><span>public</span> / <strong>users</strong></div>
            <div className="preview-actions"><button><Search size={12} /> Filter</button><button className="primary-small">Insert row</button></div>
          </header>
          <div className="preview-table-wrap">
            <table>
              <thead><tr><th>id <em>uuid</em></th><th>email <em>text</em></th><th>status <em>text</em></th><th>created_at <em>timestamptz</em></th><th>placement</th></tr></thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row[0]}>
                    {row.map((cell) => <td key={cell}>{cell}</td>)}
                    <td><span className={`placement-dot p${index}`} /> {index === 0 ? "Neon" : index === 1 ? "Supabase" : "D1"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer><span><Check size={12} /> 3 rows</span><span>Logical view</span><button><Play size={11} /> Open SQL</button></footer>
        </main>
      </div>
    </div>
  );
}
