/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    // Old marketing routes from the v1 site → closest equivalent surface in
    // the PM workspace. Permanent so search engines and existing inbound
    // links pick the new URL.
    return [
      { source: "/home", destination: "/", permanent: true },
      { source: "/about", destination: "/", permanent: true },
      { source: "/alerts", destination: "/", permanent: true },
      { source: "/alerts/:id", destination: "/", permanent: true },
      { source: "/case-studies", destination: "/patterns", permanent: true },
      { source: "/case-studies/:slug", destination: "/patterns", permanent: true },
      { source: "/funds", destination: "/peer", permanent: true },
      { source: "/funds/:ticker", destination: "/peer", permanent: true },
      { source: "/heatmap", destination: "/peer", permanent: true },
      { source: "/drift", destination: "/book", permanent: true },
      { source: "/watch", destination: "/book", permanent: true },
      { source: "/watch/:slug", destination: "/borrower/:slug", permanent: true },
    ]
  },
}

export default nextConfig
