import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
import "./globals.css";
import { NavBar } from "@/components/nav-bar";
import { SiteFooter } from "@/components/site-footer";
import { CommandPalette } from "@/components/command-palette";
import { Toaster } from "sonner";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://swarm-public.vercel.app"

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Swarm Public — Agentic intelligence for public private credit",
    template: "%s · Swarm Public",
  },
  description:
    "Live monitoring of every BDC filing on EDGAR. Three predictive detectors. Every alert cited.",
  openGraph: {
    type: "website",
    siteName: "Swarm Public",
    url: SITE_URL,
    title: "Swarm Public — Agentic intelligence for public private credit",
    description:
      "Live monitoring of every BDC filing on EDGAR. Three predictive detectors. Every alert cited.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Swarm Public",
    description:
      "Live monitoring of every BDC filing on EDGAR. Three predictive detectors. Every alert cited.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} dark`}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased flex min-h-screen flex-col bg-surface text-default`}
      >
        <NavBar />
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <CommandPalette />
        <Toaster
          theme="dark"
          position="bottom-right"
          closeButton
          richColors={false}
          toastOptions={{
            style: {
              background: "#0F1623",
              border: "1px solid #1F2937",
              color: "#E5E7EB",
            },
          }}
        />
      </body>
    </html>
  );
}
