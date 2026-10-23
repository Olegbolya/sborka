import { createWriteStream } from 'node:fs';
import { mkdir, unlink, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** P4.3: Storage interface — works with local disk now; S3 swap-in later. */
export interface StorageService {
  /** Save a stream to key; returns the absolute path. */
  save(stream: Readable, key: string): Promise<string>;
  /** Absolute path for a stored key. */
  getPath(key: string): string;
  /** Delete a stored key (no-op if missing). */
  delete(key: string): Promise<void>;
  /** Atomic move (same volume). */
  move(from: string, to: string): Promise<void>;
  /** Create necessary parent dirs for key. */
  ensureDir(key: string): Promise<void>;
}

export class LocalStorageService implements StorageService {
  constructor(private readonly baseDir: string) {}

  getPath(key: string): string {
    return path.join(this.baseDir, key);
  }

  async ensureDir(key: string): Promise<void> {
    await mkdir(path.dirname(this.getPath(key)), { recursive: true });
  }

  async save(stream: Readable, key: string): Promise<string> {
    const filePath = this.getPath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    const dest = createWriteStream(filePath);
    await pipeline(stream, dest);
    return filePath;
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.getPath(key));
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  async move(from: string, to: string): Promise<void> {
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
  }
}

/** Returns a file size for an existing path (bytes). */
export async function fileBytes(filePath: string): Promise<number> {
  const s = await stat(filePath);
  return s.size;
}

/** Saves a Buffer to the storage service under the given key. */
export async function saveBuffer(storage: StorageService, buffer: Buffer, key: string): Promise<string> {
  return storage.save(Readable.from(buffer), key);
}
