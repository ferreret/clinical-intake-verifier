import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { looksLikePdf, readPages, sha256Hex } from "@/lib/extractor/pdf";

describe("pdf", () => {
  it("reads page count and sizes in points, two decimals", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595.2755905511812, 841.8897637795276]);
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    expect(looksLikePdf(bytes)).toBe(true);
    expect(await readPages(bytes)).toEqual([
      { number: 1, width_pt: 595.28, height_pt: 841.89 },
      { number: 2, width_pt: 612, height_pt: 792 },
    ]);
  });

  it("hashes bytes with sha256 and recognises non-PDFs", () => {
    expect(sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(looksLikePdf(new Uint8Array([1, 2, 3, 4, 5]))).toBe(false);
  });
});
