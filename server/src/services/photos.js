// Photo upload handling. Every uploaded image is:
//   1. size-checked and sniffed by its magic bytes (JPEG, PNG or WebP only),
//   2. fully decoded and re-encoded as JPEG by sharp — this rejects corrupt or
//      disguised files and strips all metadata, including EXIF GPS tags,
//   3. stored under a random name outside the web root — on disk, or in the
//      photo_files table when PHOTO_STORAGE=database (cloud hosting whose disk
//      is wiped on restart).
// Files are only ever served through /api/photos/:id after an access check.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { config } from '../config.js';
import { badRequest } from '../lib/http.js';
import { sql } from '../db/index.js';

sharp.cache(false);

const MAX_DIMENSION = 1600;
const THUMB_DIMENSION = 480;

function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function validateFileList(files, { min = 0, max, label = 'photos' }) {
  const list = (files || []).filter((f) => f && f.size > 0);
  if (list.length < min) {
    throw badRequest(min === 1 ? `Please attach at least one photo.` : `Please attach at least ${min} ${label}.`);
  }
  if (list.length > max) throw badRequest(`You can attach at most ${max} ${label}.`);
  for (const f of list) {
    if (f.size > config.maxPhotoBytes) {
      throw badRequest(
        `"${String(f.name || 'photo').slice(0, 60)}" is larger than ${Math.round(config.maxPhotoBytes / 1048576)} MB.`,
      );
    }
  }
  return list;
}

// Decodes, validates and stores one image. Returns the metadata row values.
export async function storePhoto(file) {
  const input = Buffer.from(await file.arrayBuffer());
  const kind = sniff(input);
  if (!kind) {
    throw badRequest(`"${String(file.name || 'file').slice(0, 60)}" is not a supported image. Use JPEG, PNG or WebP.`);
  }
  let main;
  let thumb;
  try {
    const base = sharp(input, { limitInputPixels: 50_000_000, failOn: 'error' }).rotate();
    main = await base
      .clone()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    thumb = await base
      .clone()
      .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
  } catch {
    throw badRequest(`"${String(file.name || 'file').slice(0, 60)}" could not be read as an image.`);
  }
  const now = new Date();
  const dir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const key = `${dir}/${crypto.randomUUID()}`;
  await writeFile(key, '.jpg', main.data);
  await writeFile(key, '_thumb.jpg', thumb);
  return {
    storage_key: key,
    mime_type: 'image/jpeg',
    width: main.info.width,
    height: main.info.height,
    size_bytes: main.data.length,
  };
}

export async function storePhotos(files) {
  const stored = [];
  try {
    for (const f of files) stored.push(await storePhoto(f));
  } catch (err) {
    await removePhotoFiles(stored.map((s) => s.storage_key));
    throw err;
  }
  return stored;
}

async function writeFile(key, suffix, data) {
  if (config.photoStorage === 'database') {
    await sql`INSERT INTO photo_files (file_key, data) VALUES (${key + suffix}, ${data})`;
    return;
  }
  const file = photoPath(key, suffix);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, { flag: 'wx' });
}

// Returns the stored image bytes, or null if missing.
export async function readPhotoFile(key, suffix = '.jpg') {
  photoPath(key, suffix); // validates the key
  if (config.photoStorage === 'database') {
    const [row] = await sql`SELECT data FROM photo_files WHERE file_key = ${key + suffix}`;
    return row ? Buffer.from(row.data) : null;
  }
  try {
    return await fs.readFile(photoPath(key, suffix));
  } catch {
    return null;
  }
}

// Used to clean up files when the database transaction fails.
export async function removePhotoFiles(keys) {
  for (const key of keys) {
    for (const suffix of ['.jpg', '_thumb.jpg']) {
      if (config.photoStorage === 'database') {
        await sql`DELETE FROM photo_files WHERE file_key = ${key + suffix}`.catch(() => {});
      } else {
        await fs.rm(photoPath(key, suffix), { force: true }).catch(() => {});
      }
    }
  }
}

export function photoPath(key, suffix = '.jpg') {
  if (!/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/.test(key)) throw new Error('Invalid storage key');
  return path.join(config.uploadDir, `${key}${suffix}`);
}
