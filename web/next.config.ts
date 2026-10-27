import path from "node:path";
import type { NextConfig } from "next";

// The app lives in web/ but imports schema/ from the repository root (fields.json and the
// JSON Schemas are shared with the Python package). Point tracing and Turbopack at the root
// so those files are part of the build, locally and in the demo's container.
const repoRoot = path.resolve(process.cwd(), "..");

// The path the app is served under, as "/name" (docs/deploy.md); none by default. Fixed at
// build time, so each deployment builds with its own.
const basePath = process.env.BASE_PATH?.trim().replace(/\/+$/, "") || "";
if (basePath && !/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(basePath)) {
  throw new Error(`BASE_PATH must look like /name, got "${basePath}"`);
}

const nextConfig: NextConfig = {
  // One self-contained server for the container (Dockerfile).
  output: "standalone",
  ...(basePath ? { basePath } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // Page rendering and OCR for the local model: a native addon, pdf.js's worker and
  // Tesseract's worker threads, loaded by Node at run time rather than bundled.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "tesseract.js"],
  // What pdf.js finds at run time by path rather than import (its worker, its fonts, found
  // through its package.json), which the standalone build would otherwise leave out.
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/pdfjs-dist/package.json",
      "./node_modules/pdfjs-dist/legacy/build/**",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
    ],
  },
};

export default nextConfig;
