import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import "./product.css";
import "./product-extra.css";
import "./public.css";

export const metadata: Metadata = {
  title: { default: "MeldDB — Your databases. One backend.", template: "%s · MeldDB" },
  description: "Connect cloud databases you own and build against one logical schema, API, and developer experience.",
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { colorScheme: "dark light", themeColor: "#090A0C" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
