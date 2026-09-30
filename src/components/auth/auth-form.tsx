"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "");
    const result =
      mode === "signup"
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Authentication could not be completed.");
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      {mode === "signup" && <div className="field"><label htmlFor="name">Name</label><input id="name" name="name" autoComplete="name" required minLength={2} maxLength={80} /></div>}
      <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={12} maxLength={128} /></div>
      {mode === "signup" && <div className="password-note">Use at least 12 characters. MeldDB authentication is separate from every connected database provider.</div>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="form-button" disabled={pending} type="submit">{pending ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}</button>
      <div className="auth-switch">{mode === "signup" ? <>Already have an account? <Link href="/login">Sign in</Link></> : <>New to MeldDB? <Link href="/signup">Create an account</Link></>}</div>
    </form>
  );
}
