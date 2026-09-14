/** Files in Ads Monitoring: creatives and reference documents.
 *
 *  Creatives must be exactly 1080 × 1350 pixels and at most 1,000,000 bytes,
 *  JPG, PNG or WebP. The type and the dimensions are read from the file's own
 *  bytes (the image header), never from its name or a browser's claim, and an
 *  image that does not match is refused — never resized or recompressed.
 *
 *  References follow the existing upload rules: images up to 1 MB, documents
 *  (PDF, DOCX, XLSX, CSV) up to 5 MB. */

import { classifyReportFile, formatBytes, safeFileName } from '../team-reports';

export const CREATIVE_WIDTH = 1080;
export const CREATIVE_HEIGHT = 1350;
export const CREATIVE_MAX_BYTES = 1_000_000;
export const CREATIVE_ACCEPT = '.jpg,.jpeg,.png,.webp';
export const REFERENCE_ACCEPT = '.pdf,.docx,.xlsx,.csv,.jpg,.jpeg,.png,.webp';

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));

/** The real type and pixel size, decoded from the image header. */
export function readImageInfo(bytes: Uint8Array): { mime: ImageMime; width: number; height: number } | null {
  // PNG: signature, then the IHDR chunk carries width and height.
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG' && ascii(bytes, 12, 4) === 'IHDR') {
    return { mime: 'image/png', width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  // JPEG: walk the markers to the start-of-frame segment.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = u16be(bytes, i + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return { mime: 'image/jpeg', height: u16be(bytes, i + 5), width: u16be(bytes, i + 7) };
      if (length < 2) return null;
      i += 2 + length;
    }
    return null;
  }
  // WebP: RIFF container; the VP8, VP8L or VP8X chunk carries the canvas size.
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X') return { mime: 'image/webp', width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const b = bytes;
      const width = 1 + (((b[22] & 0x3f) << 8) | b[21]);
      const height = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6));
      return { mime: 'image/webp', width, height };
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { mime: 'image/webp', width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    }
    return null;
  }
  return null;
}

const REQUIREMENT = `Creatives must be exactly ${CREATIVE_WIDTH} × ${CREATIVE_HEIGHT} pixels, JPG, PNG or WebP, and at most 1 MB (1,000,000 bytes).`;

export function checkCreative(name: string, bytes: Uint8Array):
  { fileName: string; mime: ImageMime; width: number; height: number; sizeBytes: number } | { error: string } {
  const fileName = safeFileName(name);
  const info = readImageInfo(bytes);
  if (!info) return { error: `${fileName} is not a readable JPG, PNG or WebP image. ${REQUIREMENT}` };
  const problems: string[] = [];
  if (bytes.length > CREATIVE_MAX_BYTES) problems.push(`it is ${bytes.length.toLocaleString('en-US')} bytes (${formatBytes(bytes.length)})`);
  if (info.width !== CREATIVE_WIDTH || info.height !== CREATIVE_HEIGHT) problems.push(`it is ${info.width} × ${info.height} pixels`);
  if (problems.length) return { error: `${fileName} was not uploaded: ${problems.join(' and ')}. ${REQUIREMENT} Images are never resized or compressed for you.` };
  return { fileName, mime: info.mime, width: info.width, height: info.height, sizeBytes: bytes.length };
}

const REFERENCE_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'csv', 'jpg', 'jpeg', 'png', 'webp']);

/** Reference documents: the Team Reports rules, limited to the types Ads Monitoring accepts. */
export function checkReference(name: string, bytes: Uint8Array): { fileName: string; mimeType: string; kind: 'image' | 'document' } | { error: string } {
  const ext = safeFileName(name).toLowerCase().split('.').pop() ?? '';
  if (!REFERENCE_EXTENSIONS.has(ext) && !readImageInfo(bytes)) {
    return { error: `${safeFileName(name)}: only PDF, DOCX, XLSX, CSV, JPG, PNG or WebP files can be attached.` };
  }
  return classifyReportFile(name, bytes);
}

export { formatBytes, safeFileName };
