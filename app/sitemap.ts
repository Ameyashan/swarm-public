import type { MetadataRoute } from "next"

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://swarm-public.vercel.app"

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const surfaces = [
    { path: "/", priority: 1.0 },
    { path: "/book", priority: 0.9 },
    { path: "/peer", priority: 0.9 },
    { path: "/patterns", priority: 0.8 },
    { path: "/memo", priority: 0.8 },
    { path: "/borrower/MRI%20Software", priority: 0.7 },
  ]
  return surfaces.map((s) => ({
    url: `${SITE_URL}${s.path}`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: s.priority,
  }))
}
