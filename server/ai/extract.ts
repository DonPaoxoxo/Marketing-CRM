/** Plain text from an uploaded reference document, for use as AI context.
 *
 *  Only text formats and the modern Office packages (read with fflate, no macros
 *  run, nothing written to disk). PDFs, legacy .doc/.xls/.ppt and images are kept
 *  as files but contribute only their title and description to prompts. */

import { unzipSync, strFromU8 } from 'fflate';
import type { FileKind } from '../../src/lib/spiels';

export const EXTRACT_MAX_CHARS = 200_000;
/** Refuse to inflate archives that claim to be far larger than their upload. */
const MAX_INFLATED_BYTES = 60 * 1024 * 1024;

const decodeXmlText = (xml: string) =>
  xml
    .replace(/<\/(w:p|a:p|row)>/g, '\n')
    .replace(/<(w:tab|w:br)\b[^>]*\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export function extractText(kind: FileKind, fileName: string, bytes: Uint8Array): string | null {
  try {
    const ext = fileName.toLowerCase().split('.').pop();
    if (kind === 'text' || ext === 'csv') return new TextDecoder('utf-8').decode(bytes).slice(0, EXTRACT_MAX_CHARS);
    if (!['docx', 'pptx', 'xlsx'].includes(ext ?? '')) return null;
    let inflated = 0;
    const files = unzipSync(bytes, {
      filter: (f) => {
        const wanted = ext === 'docx' ? f.name === 'word/document.xml'
          : ext === 'pptx' ? /^ppt\/slides\/slide\d+\.xml$/.test(f.name)
            : f.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name);
        if (wanted) inflated += f.originalSize;
        return wanted && inflated <= MAX_INFLATED_BYTES;
      },
    });
    const names = Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (ext === 'xlsx') {
      // Shared strings hold almost all cell text; inline numbers add little for guidance.
      const shared = files['xl/sharedStrings.xml'];
      return shared ? decodeXmlText(strFromU8(shared).replace(/<\/si>/g, '\n')).slice(0, EXTRACT_MAX_CHARS) : null;
    }
    return names.map((n) => decodeXmlText(strFromU8(files[n]))).join('\n\n').slice(0, EXTRACT_MAX_CHARS) || null;
  } catch {
    return null;
  }
}
