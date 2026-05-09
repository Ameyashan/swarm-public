// Encode an arbitrary canonical name into a URL-safe slug.
// Uses base64url so we can round-trip names with spaces, commas, parens, etc.
export function encodeCanonicalSlug(canonical: string): string {
  // Buffer is available on the server; in client we use btoa
  if (typeof Buffer !== "undefined") {
    return Buffer.from(canonical, "utf-8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "")
  }
  return btoa(unescape(encodeURIComponent(canonical)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export function decodeCanonicalSlug(slug: string): string {
  let b64 = slug.replace(/-/g, "+").replace(/_/g, "/")
  // pad
  while (b64.length % 4) b64 += "="
  if (typeof Buffer !== "undefined") {
    return Buffer.from(b64, "base64").toString("utf-8")
  }
  return decodeURIComponent(escape(atob(b64)))
}
