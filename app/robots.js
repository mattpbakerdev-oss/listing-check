// A demo, not a product page: ask crawlers to stay out. Served at /robots.txt.
export default function robots() {
  return { rules: { userAgent: "*", disallow: "/" } };
}
