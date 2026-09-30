"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ value, text, label = "Copy" }: { value?: string; text?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const content = value ?? text ?? "";
  return <button className="product-button" type="button" onClick={async () => { await navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1600); }}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : label}</button>;
}
