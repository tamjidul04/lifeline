import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Open_Sans, Playfair_Display } from "next/font/google";
import "./globals.css";

const body = Open_Sans({ variable: "--font-sans", subsets: ["latin"] });
const display = Playfair_Display({ variable: "--font-display", weight: ["400", "700"], subsets: ["latin"] });
const mono = IBM_Plex_Mono({ variable: "--font-geist-mono", weight: ["400", "500"], subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LifeLine",
  description: "Emergency blood supply coordination: compatible matching, atomic reservations, explained decisions.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", colorScheme: "only light" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
