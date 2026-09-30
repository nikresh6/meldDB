import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthLayout } from "@/components/auth/auth-layout";
import { getSession } from "@/lib/authorization";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSession()) redirect("/app");
  return <AuthLayout><div className="auth-panel"><h1>Welcome back</h1><p>Sign in to manage your logical backend and connected infrastructure.</p><AuthForm mode="login" /><div className="configuration-note">Password reset is exposed only when an email delivery provider is configured. This prevents insecure development-only reset links.</div></div></AuthLayout>;
}
