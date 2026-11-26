import type { Metadata, Viewport } from "next";
import { Archivo_Narrow, Atkinson_Hyperlegible, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Atkinson Hyperlegible is designed for legibility, which suits clinical screens.
const body = Atkinson_Hyperlegible({ variable: "--font-sans", weight: ["400", "700"], subsets: ["latin"] });
const display = Archivo_Narrow({ variable: "--font-display", weight: ["600", "700"], subsets: ["latin"] });
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
