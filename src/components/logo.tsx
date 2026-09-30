import Image from "next/image";
import Link from "next/link";

export function Logo({ compact = false, href = "/" }: { compact?: boolean; href?: string }) {
  return (
    <Link className="logo" href={href} aria-label="MeldDB home">
      <Image src="/logo-mark.svg" alt="" width={28} height={28} priority />
      {!compact && <span>MeldDB</span>}
    </Link>
  );
}
