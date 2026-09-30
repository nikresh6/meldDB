import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthLayout } from "@/components/auth/auth-layout";
import { getSession } from "@/lib/authorization";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await getSession()) redirect("/app");
  return <AuthLayout><div className="auth-panel"><h1>Create your account</h1><p>Connect databases you legitimately own. Provider accounts and customer data stay under your control.</p><AuthForm mode="signup" /></div></AuthLayout>;
}
