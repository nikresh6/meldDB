"use client";

import { useState } from "react";
import { Database, Route, Table2 } from "lucide-react";

const routes = [
  { key: "users", label: "users", providers: ["Supabase", "Neon"] },
  { key: "orders", label: "orders", providers: ["Neon"] },
  { key: "events", label: "events", providers: ["D1", "Neon"] },
] as const;

export function ArchitectureVisual() {
  const [active, setActive] = useState<(typeof routes)[number]["key"]>("users");
  const route = routes.find((item) => item.key === active) ?? routes[0];

  return (
    <div className="architecture-visual" aria-label="Interactive demonstration of MeldDB routing">
      <div className="demo-label">Interactive architecture</div>
      <div className="architecture-grid">
        <div className="provider-stack">
          {["Supabase", "Neon", "D1"].map((provider) => (
            <div className={`provider-node ${route.providers.includes(provider as never) ? "active" : ""}`} key={provider}>
              <Database aria-hidden="true" size={15} />
              <div>
                <strong>{provider}</strong>
                <span>{provider === "D1" ? "SQLite" : "Postgres"}</span>
              </div>
              <i />
            </div>
          ))}
        </div>
        <div className="route-lines" aria-hidden="true">
          <svg viewBox="0 0 180 190" preserveAspectRatio="none">
            <path d="M0 30 C70 30 85 95 180 95" />
            <path d="M0 95 H180" />
            <path d="M0 160 C70 160 85 95 180 95" />
            <circle className="route-pulse pulse-one" r="3" />
            <circle className="route-pulse pulse-two" r="3" />
          </svg>
          <div className="router-chip"><Route size={14} /> router</div>
        </div>
        <div className="logical-node">
          <div className="logical-title"><Table2 size={15} /> Logical database</div>
          {routes.map((item) => (
            <button
              className={item.key === active ? "active" : ""}
              key={item.key}
              onClick={() => setActive(item.key)}
              type="button"
            >
              <span>{item.label}</span>
              <small>{item.providers.length} shard{item.providers.length > 1 ? "s" : ""}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="query-strip">
        <span>unified.sql</span>
        <code>SELECT * FROM {route.label} WHERE id = $1</code>
        <kbd>⌘ ↵</kbd>
      </div>
      <p className="route-caption">
        Routed to <strong>{route.providers.join(" + ")}</strong> from the logical catalog.
      </p>
    </div>
  );
}
