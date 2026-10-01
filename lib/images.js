// Image pipeline shared by book covers (lib/books/covers.js) and author
// portraits (lib/authors/photos.js). Each used to carry its own copy of
// the ImageMagick plumbing, WebP conversion, filename-stem and thumb
// writer; one module keeps their behaviour identical.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import multer from 'multer';

const CONVERT = '/usr/bin/convert';
export const THUMB_MAX_WIDTH = 400;
const THUMB_QUALITY = 85;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Pipe a buffer through ImageMagick and collect stdout. Arguments are
// constant per caller; user data only ever reaches stdin.
function runConvert(args, input, label) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(CONVERT, args);
    } catch (e) {
      return reject(e);
    }
    const chunks = [];
    let stderr = '';
    proc.stdout.on('data', c => chunks.push(c));
    proc.stderr.on('data', c => { stderr += c.toString(); });
    proc.stdin.on('error', reject);
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`${label} exited ${code}: ${stderr}`));
    });
    proc.stdin.end(input);
  });
}

// The user dislikes WebP (memory feedback_no_webp_covers.md): WebP input
// is stored as JPG.
export function webpBufferToJpg(buffer) {
  return runConvert(['webp:-', '-quality', '90', 'jpg:-'], buffer, 'convert');
}

// Max-THUMB_MAX_WIDTH JPG for grid tiles; downscale only ('>' never
// upscales), EXIF rotation honoured first.
export function generateThumbBuffer(sourceBuffer) {
  return runConvert(['-', '-auto-orient', '-resize', `${THUMB_MAX_WIDTH}x>`, '-quality', String(THUMB_QUALITY), 'jpg:-'],
    sourceBuffer, 'convert (thumb)');
}

// Magic-byte sniff. Returns one of the extensions saved files may carry,
// or null for anything that isn't a recognised image.
export function detectImageExt(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Filename minus extension, for a bare filename only (anything with a
// path component returns null — the same traversal guard every caller
// relied on). Upload names are unique, so the stem is a stable thumb key.
export function filenameStem(filename) {
  if (!filename) return null;
  if (path.basename(filename) !== filename) return null;
  const ext = path.extname(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

// Write {thumbsDir}/{stem}.jpg for a just-saved image. Best-effort: any
// failure logs and returns null — the original is already on disk and
// the client falls back to it. Skips buffers that don't sniff as an
// image (tests write placeholder bytes).
export async function writeThumb(thumbsDir, filename, sourceBuffer, label = 'image') {
  const stem = filenameStem(filename);
  if (!stem) return null;
  if (!detectImageExt(sourceBuffer)) return null;
  try {
    fs.mkdirSync(thumbsDir, { recursive: true });
    const thumb = await generateThumbBuffer(sourceBuffer);
    const outPath = path.join(thumbsDir, `${stem}.jpg`);
    await fs.promises.writeFile(outPath, thumb);
    return outPath;
  } catch (err) {
    console.error(`Thumb generation failed for ${label} ${filename}: ${err.message}`);
    return null;
  }
}

// Multipart image upload (covers, portraits): in-memory, 10 MB cap,
// image/* only. Errors carry status 400 for app.js's error handler.
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      const err = new Error('Only images allowed');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});
