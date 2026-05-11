import type { MetadataRoute } from "next"

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://swarm-public.vercel.app"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Server-rendered API surfaces are not for crawlers.
        disallow: ["/patterns/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
