"use client";

import {
  Activity,
  Braces,
  ChevronDown,
  ChevronsLeft,
  Columns3,
  Command,
  Database,
  FileCode2,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Logs,
  Menu,
  Network,
  PanelLeft,
  Search,
  Settings,
  Shield,
  TableProperties,
  TerminalSquare,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";

interface AppShellProps {
  project: { id: string; name: string; workspaceId: string };
  user: { name: string; email: string };
  children: React.ReactNode;
}

interface NavItem { label: string; path: string; icon: LucideIcon }
interface NavGroup { label: string; items: NavItem[] }

const navGroups: NavGroup[] = [
  { label: "", items: [{ label: "Overview", path: "overview", icon: LayoutDashboard }] },
  { label: "Database", items: [{ label: "Table Editor", path: "database/tables", icon: Columns3 }, { label: "SQL Editor", path: "database/sql", icon: TerminalSquare }, { label: "Schema", path: "database/schema", icon: TableProperties }] },
  { label: "Build", items: [{ label: "Auth", path: "auth", icon: Shield }, { label: "Functions", path: "functions", icon: FileCode2 }] },
  { label: "Developers", items: [{ label: "API Keys", path: "developers/api-keys", icon: KeyRound }, { label: "Developer Context", path: "developers/context", icon: Braces }, { label: "Logs", path: "developers/logs", icon: Logs }] },
  { label: "Infrastructure", items: [{ label: "Nodes", path: "infrastructure/nodes", icon: Network }, { label: "Capacity", path: "infrastructure/capacity", icon: Gauge }] },
];

export function AppShell({ project, user, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarWidth, setSidebarWidth] = useState(244);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const base = `/app/${project.id}`;

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setPaletteOpen((value) => !value);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault(); setCollapsed((value) => !value);
      }
      if (event.key === "Escape") { setPaletteOpen(false); setMobileOpen(false); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  useEffect(() => { if (paletteOpen) setTimeout(() => inputRef.current?.focus(), 30); }, [paletteOpen]);

  const actions = useMemo(
    () => navGroups.flatMap((group) => group.items).filter((item) => item.label.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  function startResize(event: React.PointerEvent) {
    if (collapsed) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const move = (moveEvent: PointerEvent) => setSidebarWidth(Math.max(210, Math.min(320, startWidth + moveEvent.clientX - startX)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  async function signOut() { await authClient.signOut(); router.push("/"); router.refresh(); }

  return (
    <div className={`app-frame ${collapsed ? "sidebar-collapsed" : ""}`} style={{ "--app-sidebar-width": `${collapsed ? 58 : sidebarWidth}px` } as React.CSSProperties}>
      <aside className={`app-sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="app-sidebar-brand"><Logo compact={collapsed} href="/app" />{!collapsed && <button aria-label="Collapse sidebar" onClick={() => setCollapsed(true)}><ChevronsLeft /></button>}</div>
        {!collapsed && <Link className="project-switcher" href="/app"><span><i>{project.name.slice(0, 1).toUpperCase()}</i><b>{project.name}</b></span><ChevronDown /></Link>}
        <nav className="app-nav" aria-label="Product navigation">
          {navGroups.map((group) => <div className="app-nav-group" key={group.label || "overview"}>{!collapsed && group.label && <small>{group.label}</small>}{group.items.map((item) => { const href = `${base}/${item.path}`; const active = pathname === href || (item.path === "overview" && pathname === base); return <Link className={active ? "active" : ""} href={href} key={item.path} title={collapsed ? item.label : undefined} onClick={() => setMobileOpen(false)}><item.icon /><span>{item.label}</span></Link>; })}</div>)}
        </nav>
        <div className="app-sidebar-bottom">
          <Link className={pathname.endsWith("/settings") ? "active" : ""} href={`${base}/settings`} title="Settings"><Settings /><span>Settings</span></Link>
          {!collapsed && <button className="user-chip" onClick={signOut} title="Sign out"><i>{user.name.slice(0, 2).toUpperCase()}</i><span><b>{user.name}</b><small>{user.email}</small></span></button>}
        </div>
        <div className="sidebar-resize" onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label="Resize sidebar" />
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></button>
          {collapsed && <button className="sidebar-open" onClick={() => setCollapsed(false)} aria-label="Expand sidebar"><PanelLeft /></button>}
          <div className="breadcrumbs"><span>{project.name}</span><b>/</b><strong>{pathname.split("/").at(-1)?.replaceAll("-", " ") || "overview"}</strong></div>
          <button className="command-trigger" onClick={() => setPaletteOpen(true)}><Search /><span>Search or jump to…</span><kbd>⌘ K</kbd></button>
          <div className="system-status"><i /> Control plane</div>
        </header>
        <main className="app-content">{children}</main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Mobile product navigation"><Link href={`${base}/overview`}><LayoutDashboard /><span>Overview</span></Link><Link href={`${base}/database/tables`}><Database /><span>Tables</span></Link><button onClick={() => setPaletteOpen(true)}><Command /><span>Command</span></button><Link href={`${base}/infrastructure/nodes`}><Activity /><span>Nodes</span></Link></nav>
      {mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      {paletteOpen && <div className="command-overlay" role="presentation" onMouseDown={() => setPaletteOpen(false)}><div className="command-dialog" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}><div className="command-input"><Search /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages and actions" aria-label="Search commands" /><button onClick={() => setPaletteOpen(false)}><X /></button></div><div className="command-results"><small>GO TO</small>{actions.map((item) => <button key={item.path} onClick={() => { router.push(`${base}/${item.path}`); setPaletteOpen(false); setQuery(""); }}><item.icon /><span>{item.label}</span><kbd>↵</kbd></button>)}{actions.length === 0 && <p>No command matches “{query}”.</p>}</div><footer><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>esc</kbd> close</span></footer></div></div>}
    </div>
  );
}
