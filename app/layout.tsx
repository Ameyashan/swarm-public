import type { Metadata } from "next"
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google"
import "./globals.css"
import { NavBar } from "@/components/nav-bar"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

// NOTE: spec calls for "Source Serif Pro". next/font/google ships the
// successor family Source Serif 4 (same Adobe family, renamed in 2022); we
// load that and keep "Source Serif Pro" in the CSS fallback stack so machines
// with the original family installed render identically.
const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
})

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
})

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://swarm-public.vercel.app"

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Swarm — credit intelligence for Goldman PMs",
    template: "%s · Swarm",
  },
  description:
    "Morning briefing, position book, borrower x-ray, peer telemetry, patterns, and memo composer for the Goldman PM managing GSCR + GSBD.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${serif.variable} ${jetbrains.variable}`}
    >
      <body className="min-h-screen bg-bg text-text antialiased">
        <NavBar />
        <div className="mx-auto w-full max-w-[1280px] px-6 py-6">
          {children}
        </div>
      </body>
    </html>
  )
}
