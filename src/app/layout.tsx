import type { Metadata, Viewport } from "next";
import { Source_Serif_4 } from "next/font/google";
import "./globals.css";

/**
 * Display face only. Body text uses the platform UI stack (see tokens.css),
 * which renders as SF on iOS and Roboto on Android — matching the mockups on
 * the device this is actually built for, at zero download cost.
 */
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-source-serif",
});

export const metadata: Metadata = {
  title: "Summerlake — Front Porch",
  description: "A living directory for your neighbourhood.",
  applicationName: "Front Porch",
  appleWebApp: { capable: true, title: "Front Porch", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#faf7f0",
  width: "device-width",
  initialScale: 1,
  // The map needs pinch-zoom, so maximumScale is deliberately not clamped —
  // locking it out would fail WCAG 1.4.4 and break the primary interaction.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={sourceSerif.variable}>
      <body>{children}</body>
    </html>
  );
}
