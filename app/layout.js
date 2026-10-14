import { IBM_Plex_Sans, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

// One family with a Thai companion: drafts are bilingual.
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const plexThai = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600"], variable: "--font-thai", display: "swap" });

export const metadata = {
  title: "Listing Check",
  description: "Check a Bangkok rental listing for missing details and a sensible price before you publish it.",
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${plex.variable} ${plexThai.variable}`}>
      <body>{children}</body>
    </html>
  );
}
