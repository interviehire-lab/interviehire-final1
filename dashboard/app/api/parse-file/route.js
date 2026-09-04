import { createRequire } from 'node:module';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — cap before buffering into memory
const require = createRequire(import.meta.url);

async function ensurePdfNodePolyfills() {
  if (globalThis.DOMMatrix && globalThis.ImageData && globalThis.Path2D) return;

  const canvas = require('@napi-rs/canvas');
  globalThis.DOMMatrix ||= canvas.DOMMatrix;
  globalThis.ImageData ||= canvas.ImageData;
  globalThis.Path2D ||= canvas.Path2D;
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 413 });
    }

    if (typeof file.size === 'number' && file.size === 0) {
      return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();
    let text = '';

    if (fileName.endsWith('.txt')) {
      text = buffer.toString('utf-8');
    } else if (fileName.endsWith('.pdf')) {
      await ensurePdfNodePolyfills();

      // Next's webpack transform currently breaks pdf-parse's ESM bundle during
      // route evaluation ("Object.defineProperty called on non-object"). Load its
      // supported Node CJS export instead; next.config keeps it server-external.
      const pdfModule = require('pdf-parse');
      const PDFParseClass = pdfModule.PDFParse;
      
      if (PDFParseClass) {
        const parser = new PDFParseClass({ data: buffer });
        try {
          const result = await parser.getText();
          text = result.text || '';
        } finally {
          await parser.destroy();
        }
      } else {
        const pdfParseFn = pdfModule.default || pdfModule;
        if (typeof pdfParseFn === 'function') {
          const data = await pdfParseFn(buffer);
          text = data.text || '';
        } else {
          throw new Error('Could not find a valid PDF parser in pdf-parse dependency');
        }
      }
    } else if (fileName.endsWith('.docx')) {
      const mammothModule = await import('mammoth');
      const mammoth = mammothModule.default || mammothModule;
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      return NextResponse.json({ error: 'Unsupported file type. Use .pdf, .docx, or .txt' }, { status: 400 });
    }

    text = text.trim();
    if (!text) {
      return NextResponse.json({ error: 'No readable text found in the file' }, { status: 422 });
    }

    return NextResponse.json({ text });
  } catch (error) {
    console.error('File parse error:', error);
    return NextResponse.json(
      {
        error: 'Failed to parse file',
        detail: process.env.NODE_ENV === 'production' ? undefined : error.message
      },
      { status: 500 }
    );
  }
}
