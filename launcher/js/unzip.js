// A small, dependency-free ZIP reader. Enough of the format to open the .zip a
// player picked off their phone: stored and deflated entries, UTF-8 names, and
// the ZIP64 fields that show up once an archive holds a few big samples.
//
// Deflate is handed to the platform's DecompressionStream, so there is no
// inflate implementation to carry around.

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOC64 = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

export class ZipError extends Error {}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Array<{name: string, data: Uint8Array, dir: boolean}>>}
 */
export async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEocd(view);

  let entryCount = view.getUint16(eocd + 10, true);
  let cenOffset = view.getUint32(eocd + 16, true);

  // ZIP64: the 32-bit fields saturate and the real numbers live in a second record.
  if (entryCount === 0xffff || cenOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && view.getUint32(loc, true) === SIG_LOC64) {
      const rec = Number(view.getBigUint64(loc + 8, true));
      if (view.getUint32(rec, true) === SIG_EOCD64) {
        entryCount = Number(view.getBigUint64(rec + 32, true));
        cenOffset = Number(view.getBigUint64(rec + 48, true));
      }
    }
  }

  const out = [];
  let p = cenOffset;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > view.byteLength || view.getUint32(p, true) !== SIG_CEN) break;

    const method = view.getUint16(p + 10, true);
    const flags = view.getUint16(p + 8, true);
    let compSize = view.getUint32(p + 20, true);
    let uncompSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    let localOffset = view.getUint32(p + 42, true);

    const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), flags);

    if (uncompSize === 0xffffffff || compSize === 0xffffffff || localOffset === 0xffffffff) {
      const z = readZip64Extra(view, p + 46 + nameLen, extraLen, uncompSize, compSize, localOffset);
      uncompSize = z.uncompSize; compSize = z.compSize; localOffset = z.localOffset;
    }

    p += 46 + nameLen + extraLen + commentLen;

    const isDir = name.endsWith('/');
    if (isDir) { out.push({ name, data: new Uint8Array(0), dir: true }); continue; }

    // The local header repeats the name and carries its own extra field, whose
    // length usually differs from the central one - so re-read it here.
    if (view.getUint32(localOffset, true) !== SIG_LOC) {
      throw new ZipError('Corrupt archive: bad local header for "' + name + '"');
    }
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + compSize);

    let data;
    if (method === 0) {
      data = raw.slice();
    } else if (method === 8) {
      data = await inflateRaw(raw, uncompSize);
    } else {
      throw new ZipError('"' + name + '" uses an unsupported compression method (' + method + '). ' +
        'Re-zip the mod with normal deflate compression.');
    }
    out.push({ name, data, dir: false });
  }

  if (!out.length) throw new ZipError('That archive has no files in it.');
  return out;
}

function findEocd(view) {
  // The end-of-central-directory record is last, but a trailing comment can push
  // it up to 64KB back from the end.
  const max = Math.min(view.byteLength, 0xffff + 22);
  for (let i = 22; i <= max; i++) {
    const at = view.byteLength - i;
    if (at < 0) break;
    if (view.getUint32(at, true) === SIG_EOCD) return at;
  }
  throw new ZipError('This does not look like a .zip file.');
}

function readZip64Extra(view, at, len, uncompSize, compSize, localOffset) {
  const end = at + len;
  while (at + 4 <= end) {
    const id = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    if (id === 0x0001) {
      let q = at + 4;
      if (uncompSize === 0xffffffff) { uncompSize = Number(view.getBigUint64(q, true)); q += 8; }
      if (compSize === 0xffffffff) { compSize = Number(view.getBigUint64(q, true)); q += 8; }
      if (localOffset === 0xffffffff) { localOffset = Number(view.getBigUint64(q, true)); q += 8; }
      break;
    }
    at += 4 + size;
  }
  return { uncompSize, compSize, localOffset };
}

function decodeName(raw, flags) {
  // Bit 11 promises UTF-8. Plenty of zippers set it wrong, and UTF-8 decoding of
  // plain ASCII is identical anyway, so just always try UTF-8 first.
  try {
    return new TextDecoder('utf-8', { fatal: !(flags & 0x800) }).decode(raw);
  } catch {
    return new TextDecoder('windows-1252').decode(raw);
  }
}

async function inflateRaw(raw, expectedSize) {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('This browser cannot unpack compressed zips. ' +
      'Use a recent Chrome, Edge, Firefox or Safari.');
  }
  // A Uint8Array view over a larger buffer has to be copied before it can be
  // enqueued, or the stream sees the whole underlying buffer.
  const src = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const chunks = [];
  let total = 0;
  const reader = src.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  if (expectedSize && total !== expectedSize) {
    console.warn('[dops] zip entry inflated to', total, 'bytes, header said', expectedSize);
  }
  return out;
}
