import { IBM_Plex_Sans, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

// One family with a Thai companion: drafts are bilingual.
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const plexThai = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600"], variable: "--font-thai", display: "swap" });

const SITE = "https://listing-check.vercel.app";
const DESCRIPTION = "Check a Bangkok rental listing before it goes live: what is missing, whether the price makes sense, and a cleaner English and Thai version.";

export const metadata = {
  metadataBase: new URL(SITE),
  title: "Listing Check",
  description: DESCRIPTION,
  // A demo, not a product page: keep it out of search results. Link previews in chat still work.
  robots: { index: false, follow: false },
  openGraph: {
    title: "Listing Check",
    description: DESCRIPTION,
    url: SITE,
    siteName: "Listing Check",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 843, alt: "Listing Check: the draft form on the left, the score ring and price check on the right" }],
  },
  twitter: { card: "summary_large_image", title: "Listing Check", description: DESCRIPTION, images: ["/og.png"] },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
    ],
  },
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${plex.variable} ${plexThai.variable}`}>
      <body>
        {children}
        <footer className="foot">
          Demo by Matt Baker. Runs on sample data. Drafts stay in your browser; rewrite requests are logged without anything that identifies you. <a href="https://github.com/mattpbakerdev-oss/listing-check">Source on GitHub</a>.
        </footer>
      </body>
    </html>
  );
}
