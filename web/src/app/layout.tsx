import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Downloaded at build time and served by the app itself: no request to Google from the browser.
const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

const description =
  "AI-assisted intake of clinical lab requests with a human in the loop. The model is one source among several, not the source of truth.";

export const metadata: Metadata = {
  // Where the demo is served, so that the share image (opengraph-image.jpg) gets an absolute URL.
  metadataBase: new URL(process.env.PUBLIC_URL?.trim() || "http://localhost:3000"),
  title: "Intake Verifier",
  description,
  openGraph: { title: "Intake Verifier", description, type: "website" },
  twitter: { card: "summary_large_image", title: "Intake Verifier", description },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
