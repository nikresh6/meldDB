import { Logo } from "@/components/logo";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-side"><Logo /><blockquote>“Complexity should be hidden without being lied about.”<span>MeldDB design principle</span></blockquote><small>You own the databases. MeldDB connects them.</small></section>
      <section className="auth-main">{children}</section>
    </main>
  );
}
