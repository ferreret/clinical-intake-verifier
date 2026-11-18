import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { renderPages } from "@/lib/extractor/render";

/**
 * Two synthetic 160 x 64 pt pages, a frame and a black block drawn by the test's author (no
 * real document), with the image stored the way scanners store it: CCITT fax (a TIFF scan,
 * written by Pillow) and JPEG 2000 (a desktop scanner's PDF). pdf.js decodes both with its
 * WebAssembly decoders; without them it draws the page blank and raises no error.
 */
const CCITT_PDF =
  "JVBERi0xLjQKJSBjcmVhdGVkIGJ5IFBpbGxvdyBQREYgZHJpdmVyCjQgMCBvYmo8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMg" +
  "NSAwIFIKPj5lbmRvYmoKNSAwIG9iajw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDIgMCBSIF0KPj5lbmRvYmoK" +
  "MSAwIG9iajw8Ci9UeXBlIC9YT2JqZWN0Ci9TdWJ0eXBlIC9JbWFnZQovV2lkdGggMTYwCi9IZWlnaHQgNjQKL0ZpbHRlciBb" +
  "IC9DQ0lUVEZheERlY29kZSBdCi9EZWNvZGVQYXJtcyBbIDw8Ci9LIC0xCi9CbGFja0lzMSB0cnVlCi9Db2x1bW5zIDE2MAov" +
  "Um93cyA2NAo+PiBdCi9CaXRzUGVyQ29tcG9uZW50IDEKL0NvbG9yU3BhY2UgL0RldmljZUdyYXkKL0xlbmd0aCAyMjAKPj5z" +
  "dHJlYW0KJqGQDV/Lko/+YDIAj////////////5BN/////////////////////////////////+P///////////x/+P8AEAEA" +
  "CwAAAQMAAQAAAKAAAAABAQMAAQAAAEAAAAACAQMAAQAAAAEAAAADAQMAAQAAAAQAAAAGAQMAAQAAAAEAAAARAQQAAQAAAAgA" +
  "AAAWAQMAAQAAAEAAAAAXAQQAAQAAAEEAAAAaAQUAAQAAANQAAAAbAQUAAQAAANwAAAAcAQMAAQAAAAEAAAAAAAAASAAAAAEA" +
  "AABIAAAAAQAAAAplbmRzdHJlYW0KZW5kb2JqCjIgMCBvYmo8PAovUmVzb3VyY2VzIDw8Ci9Qcm9jU2V0IFsgL1BERiAvSW1h" +
  "Z2VCIF0KL1hPYmplY3QgPDwKL2ltYWdlIDEgMCBSCj4+Cj4+Ci9NZWRpYUJveCBbIDAgMCAxNjAuMCA2NC4wIF0KL0NvbnRl" +
  "bnRzIDMgMCBSCi9UeXBlIC9QYWdlCi9QYXJlbnQgNSAwIFIKPj5lbmRvYmoKMyAwIG9iajw8Ci9MZW5ndGggNDYKPj5zdHJl" +
  "YW0KcSAxNjAuMDAwMDAwIDAgMCA2NC4wMDAwMDAgMCAwIGNtIC9pbWFnZSBEbyBRCgplbmRzdHJlYW0KZW5kb2JqCjYgMCBv" +
  "Ymo8PAovQ3JlYXRpb25EYXRlIChEOjIwMjYxMTE4MTIxMjE1WikKL01vZERhdGUgKEQ6MjAyNjExMTgxMjEyMTVaKQo+PmVu" +
  "ZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM2IGYgCjAwMDAwMDAxNDQgMDAwMDAgbiAKMDAwMDAwMDYwNCAwMDAwMCBu" +
  "IAowMDAwMDAwNzY1IDAwMDAwIG4gCjAwMDAwMDAwNDAgMDAwMDAgbiAKMDAwMDAwMDA4NyAwMDAwMCBuIAowMDAwMDAwODU5" +
  "IDAwMDAwIG4gCnRyYWlsZXIKPDwKL1Jvb3QgNCAwIFIKL1NpemUgNwovSW5mbyA2IDAgUgo+PgpzdGFydHhyZWYKOTQxCiUl" +
  "RU9G";
const JPX_PDF =
  "JVBERi0xLjUKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5" +
  "cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVu" +
  "dCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAxNjAgNjRdIC9SZXNvdXJjZXMgPDwgL1hPYmplY3QgPDwgL0ltMCA0IDAgUiA+PiA+" +
  "PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL1hPYmplY3QgL1N1YnR5cGUgL0ltYWdlIC9X" +
  "aWR0aCAxNjAgL0hlaWdodCA2NCAvQ29sb3JTcGFjZSAvRGV2aWNlR3JheSAvQml0c1BlckNvbXBvbmVudCA4IC9GaWx0ZXIg" +
  "L0pQWERlY29kZSAvTGVuZ3RoIDEyNDMgPj4Kc3RyZWFtCgAAAAxqUCAgDQqHCgAAABRmdHlwanAyIAAAAABqcDIgAAAALWpw" +
  "MmgAAAAWaWhkcgAAAEAAAACgAAEHBwAAAAAAD2NvbHIBAAAAAAARAAAEjmpwMmP/T/9RACkAAAAAAKAAAABAAAAAAAAAAAAA" +
  "AACgAAAAQAAAAAAAAAAAAAEHAQH/UgAMAAAAAQAFBAQAAf9cABNAQEhIUEhIUEhIUEhIUEhIUP9kACUAAUNyZWF0ZWQgYnkg" +
  "T3BlbkpQRUcgdmVyc2lvbiAyLjUuNP+QAAoAAAAABA0AAf+T34BYEdorU3GmADmujWzPwC78w2PwDAtHXsjA1yPV8uBvD2oO" +
  "dAfa9Zn1nDPsSQweEP1H99vxlIFpP8/Abn4FEPtGwBipyK+XEB0+WPxU41Fy8DIH2iz2IsGwYNB37xrVOLkvP8s0OnmC/zq/" +
  "3Sx8dsuJlXR/2NwDsWdz0YgFvZgWSp72/38Vti0iDvnu6XVKma6zRKSmBpQ7UuC736Zscg/fmeX5rUfgVHolNpsOK8xCa0ga" +
  "jWiJc+IYpPc9nIv5la+mkdV+aXqj0WLz+X4UD9mbFRg3/PP3+2hRsGww/sdTIRFZH26MpFEY7QqtXzY+Gja0RvWsbRiQt6Tk" +
  "Zv5JL0H2QAcDZ3raBpSm2zOgeRIAU+aADq6rBP2fSNaV1kWy/YwqdO7n/I0hMLGZFRAvrBfjj0fqVf8SV29AW1lCP3Q53XPC" +
  "a7Z+Z5C0tGEIL/gGzbAI2nniv1hlZ3mIN9x7JRStDrh7nEwLj9+blfnXsPtNgJMeO3QeiWv3SAKk9WzwI287k28WP09Aco+C" +
  "0kK+dKYC+4Tlh1yr0ZRyoRm8ijl6CY0zxE71crahzpRU+0l7rYDNRiu6uqfT539MZQQOk+D/QO5uhlqLfzWMhcRt5XGKMU6m" +
  "uJ1rve6E0Exn5ZQMa4fb78sr8S1nzlKj8mTx5mZctIQ1ZgrM0aTnxlJXWVX7NjMdpP6PWQEBHqiDVj7QKX5oG+OyFIwkJLbF" +
  "T+1VOpdWcb5dbai69OY9tKqqqqqqtVpGLkPidbrVVVVVVVu/weiIic8kkkkkkkkkkkkkku0mKnY5uVeE49+Um22222222235" +
  "QpKZnYHiX89tttttttttttttxLjR7Vku29Y9+Um222222223CE4vwPdV9Fkkkkkkkkkkkkkkkl0jzsVQFRLLkJJd2hLRZz2R" +
  "ifWCgIX0dpiUNC3PNYOF2YBbDsUI1Zr+xKpRkeOXkjRkGo1K+7SakmdwrufwJP4EefwdP4HuH7RP9oYAGeoMKMCv4v8LRCVw" +
  "02wgbOwIVHMIkstFkqtwcjA14QBxykZniBClVUwQSHI2PnTUWg3vLXHVRzW4uQSgZLk4SG+YUNNPrw0g1ry3/37O9PA2GO8H" +
  "mGMkuvGyTZ7corOMOnZSzBjCeJCX7KhOnHAHFPNdE+pA8EAgMJCX+v9aJwAAAwkJdwJ+3QAAAAwkJf6dFMABhIS+8yMIAGEh" +
  "L9x0cABhIS+8yMIAGEhL9eusABhIS+8yMIAGEhL/fw7SbezWlFbi3UGMArdSMSOqD+BCMJBx5rUX4wAAMIlCDl/7SiYRx3m7" +
  "ke0qBHEJE2n0KYI4g2m0+hTBHD8V8Cf+4kzh1CXPv0rsm9oQq51vUqRKc4cmtngZBsSf/9kKZW5kc3RyZWFtCmVuZG9iago1" +
  "IDAgb2JqCjw8IC9MZW5ndGggMjkgPj4Kc3RyZWFtCnEgMTYwIDAgMCA2NCAwIDAgY20gL0ltMCBEbyBRCmVuZHN0cmVhbQpl" +
  "bmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAg" +
  "biAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQ0IDAwMDAwIG4gCjAwMDAwMDE2NTUgMDAwMDAgbiAKdHJhaWxlcgo8" +
  "PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgoxNzM0CiUlRU9GCg==";

/** Share of dark pixels in a rendered page: about 0.3 for these pages, 0 for a blank one. */
async function ink(png: Uint8Array): Promise<number> {
  const image = await loadImage(Buffer.from(png));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark += 1;
  return dark / (data.length / 4);
}

describe("renderPages on scanned images", () => {
  it.each([
    ["CCITT fax", CCITT_PDF],
    ["JPEG 2000", JPX_PDF],
  ])("draws a %s page instead of a blank one", async (_, base64) => {
    const [png] = await renderPages(new Uint8Array(Buffer.from(base64, "base64")), 72);
    expect(await ink(png)).toBeGreaterThan(0.2);
  });
});
