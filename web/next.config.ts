import path from "node:path";
import type { NextConfig } from "next";

// The app lives in web/ but imports schema/ from the repository root (fields.json and the
// JSON Schemas are shared with the Python package). Point tracing and Turbopack at the root
// so those files are part of the build, locally and in the demo's container.
const repoRoot = path.resolve(process.cwd(), "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // Page rendering and OCR for the local model: a native addon, pdf.js's worker and
  // Tesseract's worker threads, loaded by Node at run time rather than bundled.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "tesseract.js"],
};

export default nextConfig;
