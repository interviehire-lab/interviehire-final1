import { createRequire } from 'node:module';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB cap before buffering into memory
const require = createRequire(import.meta.url);

// Turn a shared Google Docs/Drive link into a directly-fetchable URL.
// Works for "anyone with the link" docs; private docs return Google's HTML
// sign-in page, which we detect and surface as a clear error.
function normalizeDocUrl(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { return null; }
  const host = url.hostname;

  let m = url.pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (host.includes('docs.google.com') && m) {
    return { fetchUrl: `https://docs.google.com/document/d/${m[1]}/export?format=txt` };
  }
  m = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (host.includes('docs.google.com') && m) {
    return { fetchUrl: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv` };
  }
  const driveId = (url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || [])[1] || url.searchParams.get('id');
  if (host.includes('drive.google.com') && driveId) {
    return { fetchUrl: `https://drive.google.com/uc?export=download&id=${driveId}` };
  }
  return { fetchUrl: url.href };
}

async function extractText(buffer, contentType) {
  const ct = (contentType || '').toLowerCase();

  if (ct.includes('application/pdf')) {
    const pdfModule = require('pdf-parse');
    const PDFParseClass = pdfModule.PDFParse;
    if (PDFParseClass) {
      const parser = new PDFParseClass({ data: buffer });
      try { return (await parser.getText()).text || ''; } finally { await parser.destroy(); }
    }
    const fn = pdfModule.default || pdfModule;
    if (typeof fn === 'function') return (await fn(buffer)).text || '';
    throw new Error('PDF parser unavailable');
  }

  if (ct.includes('officedocument.wordprocessingml') || ct.includes('msword')) {
    const mammothModule = await import('mammoth');
    const mammoth = mammothModule.default || mammothModule;
    return (await mammoth.extractRawText({ buffer })).value;
  }

  let text = buffer.toString('utf-8');
  if (ct.includes('text/html')) {
    if (/accounts\.google\.com|request access|need permission|sign in to continue/i.test(text)) {
      throw new Error('Document is not publicly accessible — set sharing to "Anyone with the link".');
    }
    text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  }
  return text;
}

export async function POST(request) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'No url provided' }, { status: 400 });
    }
    const norm = normalizeDocUrl(url);
    if (!norm) return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });

    const res = await fetch(norm.fetchUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IntervieHire/1.0)' },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Could not fetch document (HTTP ${res.status}).` }, { status: 502 });
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'Document too large (max 8 MB).' }, { status: 413 });
    }

    const text = (await extractText(buffer, res.headers.get('content-type'))).replace(/\s+\n/g, '\n').trim();
    if (!text) {
      return NextResponse.json({ error: 'No readable text found in the document.' }, { status: 422 });
    }
    return NextResponse.json({ text });
  } catch (error) {
    console.error('fetch-doc error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch document' },
      { status: 500 },
    );
  }
}
