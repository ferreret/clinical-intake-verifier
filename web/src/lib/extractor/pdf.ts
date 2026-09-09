/** What the extractor learns from the PDF itself, without any model: hash and page sizes. */
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { PageInfo } from "@/lib/schema/prediction";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function readPages(bytes: Uint8Array): Promise<PageInfo[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPages().map((page, i) => {
    const { width, height } = page.getSize();
    return { number: i + 1, width_pt: round2(width), height_pt: round2(height) };
  });
}
