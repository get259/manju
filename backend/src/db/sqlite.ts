import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type ImageRow = {
  id: number;
  source_url: string;
  mime_type: string;
  content: Buffer;
  shot_index: number | null;
  shot_text: string | null;
  created_at: string;
};

type VideoRow = {
  id: number;
  source_url: string;
  mime_type: string;
  content: Buffer;
  shot_index: number | null;
  shot_text: string | null;
  image_id: number | null;
  task_id: string | null;
  model: string | null;
  mode: string | null;
  sound: string | null;
  requested_seconds: string | null;
  requested_size: string | null;
  result_duration: string | null;
  result_size: string | null;
  result_format: string | null;
  created_at: string;
};

export type ResourceItem = {
  kind: "image" | "video";
  type: "image" | "video";
  id: number;
  localUrl: string;
  sourceUrl: string;
  shotIndex: number | null;
  shotText: string | null;
  createdAt: string;
  meta?: {
    imageId?: number | null;
    taskId?: string | null;
    model?: string | null;
    mode?: string | null;
    sound?: string | null;
    requestedSeconds?: string | null;
    requestedSize?: string | null;
    resultDuration?: string | null;
    resultSize?: string | null;
    resultFormat?: string | null;
  };
};

export type StoreVideoMeta = {
  imageId?: number;
  shotIndex?: number;
  shotText?: string;
  taskId?: string;
  model?: string;
  mode?: "std" | "pro";
  sound?: "on" | "off";
  requestedSeconds?: "5" | "10";
  requestedSize?: string;
  resultDuration?: string;
  resultSize?: string;
  resultFormat?: string;
};

const dbPath = resolveDbPath(process.env.SQLITE_PATH || "./data/app.db");
const db = openDatabase(dbPath);
migrateSchema();

const insertImageStmt = db.prepare(
  "INSERT INTO images (source_url, mime_type, content, shot_index, shot_text) VALUES (?, ?, ?, ?, ?)"
);

const insertVideoStmt = db.prepare(
  "INSERT INTO videos (source_url, mime_type, content, image_id, shot_index, shot_text, task_id, model, mode, sound, requested_seconds, requested_size, result_duration, result_size, result_format) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
);

const getImageByIdStmt = db.prepare(
  "SELECT id, source_url, mime_type, content, shot_index, shot_text, created_at FROM images WHERE id = ?"
);

const getVideoByIdStmt = db.prepare(
  "SELECT id, source_url, mime_type, content, image_id, shot_index, shot_text, task_id, model, mode, sound, requested_seconds, requested_size, result_duration, result_size, result_format, created_at FROM videos WHERE id = ?"
);

const getVideoByIdsStmt = db.prepare(
  "SELECT id, source_url, mime_type, image_id, shot_index, shot_text, task_id, model, mode, sound, requested_seconds, requested_size, result_duration, result_size, result_format, created_at FROM videos WHERE id = ?"
);

const listImagesStmt = db.prepare(
  "SELECT id, source_url, shot_index, shot_text, created_at FROM images ORDER BY id DESC LIMIT ?"
);

const listVideosStmt = db.prepare(
  "SELECT id, source_url, image_id, shot_index, shot_text, task_id, model, mode, sound, requested_seconds, requested_size, result_duration, result_size, result_format, created_at FROM videos ORDER BY id DESC LIMIT ?"
);

const deleteImageByIdStmt = db.prepare("DELETE FROM images WHERE id = ?");
const deleteVideoByIdStmt = db.prepare("DELETE FROM videos WHERE id = ?");

function resolveDbPath(input: string): string {
  if (path.isAbsolute(input)) return input;
  return path.resolve(process.cwd(), input);
}

function safeAddColumn(sql: string): void {
  try {
    db.exec(sql);
  } catch {
    return;
  }
}

function openDatabase(filePath: string): Database.Database {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const connection = new Database(filePath);
  connection.exec(
    "CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY AUTOINCREMENT, source_url TEXT NOT NULL, mime_type TEXT NOT NULL, content BLOB NOT NULL, shot_index INTEGER, shot_text TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
  );
  connection.exec(
    "CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT, source_url TEXT NOT NULL, mime_type TEXT NOT NULL, content BLOB NOT NULL, image_id INTEGER, shot_index INTEGER, shot_text TEXT, task_id TEXT, model TEXT, mode TEXT, sound TEXT, requested_seconds TEXT, requested_size TEXT, result_duration TEXT, result_size TEXT, result_format TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
  );
  return connection;
}

function migrateSchema(): void {
  safeAddColumn("ALTER TABLE images ADD COLUMN shot_index INTEGER");
  safeAddColumn("ALTER TABLE images ADD COLUMN shot_text TEXT");

  safeAddColumn("ALTER TABLE videos ADD COLUMN image_id INTEGER");
  safeAddColumn("ALTER TABLE videos ADD COLUMN shot_index INTEGER");
  safeAddColumn("ALTER TABLE videos ADD COLUMN shot_text TEXT");
  safeAddColumn("ALTER TABLE videos ADD COLUMN task_id TEXT");
  safeAddColumn("ALTER TABLE videos ADD COLUMN model TEXT");
  safeAddColumn("ALTER TABLE videos ADD COLUMN mode TEXT");
  safeAddColumn("ALTER TABLE videos ADD COLUMN sound TEXT");
  safeAddColumn("ALTER TABLE videos ADD COLUMN requested_seconds TEXT");
  safeAddColumn("ALTER TABLE videos ADD COLUMN requested_size TEXT");
  safeAddColumn("ALTER TABLE videos ADD COLUMN result_duration TEXT");
  safeAddColumn("ALTER TABLE videos ADD COLUMN result_size TEXT");
  safeAddColumn("ALTER TABLE videos ADD COLUMN result_format TEXT");
}

export function initSqlite(): void {
  db.pragma("journal_mode = WAL");
  migrateSchema();
}

async function downloadBinary(sourceUrl: string): Promise<{ mimeType: string; content: Buffer }> {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Download media failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
  }
  const mimeType = res.headers.get("content-type") || "application/octet-stream";
  const arr = await res.arrayBuffer();
  return { mimeType, content: Buffer.from(arr) };
}

export async function storeImageFromUrl(sourceUrl: string, shotIndex?: number, shotText?: string): Promise<{ id: number; mimeType: string }> {
  const media = await downloadBinary(sourceUrl);
  const inserted = insertImageStmt.run(sourceUrl, media.mimeType, media.content, shotIndex ?? null, shotText ?? null);
  return { id: Number(inserted.lastInsertRowid), mimeType: media.mimeType };
}

export async function storeVideoFromUrl(sourceUrl: string, meta?: StoreVideoMeta): Promise<{ id: number; mimeType: string }> {
  const media = await downloadBinary(sourceUrl);
  const inserted = insertVideoStmt.run(
    sourceUrl,
    media.mimeType,
    media.content,
    meta?.imageId ?? null,
    meta?.shotIndex ?? null,
    meta?.shotText ?? null,
    meta?.taskId ?? null,
    meta?.model ?? null,
    meta?.mode ?? null,
    meta?.sound ?? null,
    meta?.requestedSeconds ?? null,
    meta?.requestedSize ?? null,
    meta?.resultDuration ?? null,
    meta?.resultSize ?? null,
    meta?.resultFormat ?? null
  );
  return { id: Number(inserted.lastInsertRowid), mimeType: media.mimeType };
}

export function storeVideoFromBuffer(
  content: Buffer,
  mimeType: string,
  sourceUrl: string,
  meta?: StoreVideoMeta
): { id: number; mimeType: string } {
  const inserted = insertVideoStmt.run(
    sourceUrl,
    mimeType,
    content,
    meta?.imageId ?? null,
    meta?.shotIndex ?? null,
    meta?.shotText ?? null,
    meta?.taskId ?? null,
    meta?.model ?? null,
    meta?.mode ?? null,
    meta?.sound ?? null,
    meta?.requestedSeconds ?? null,
    meta?.requestedSize ?? null,
    meta?.resultDuration ?? null,
    meta?.resultSize ?? null,
    meta?.resultFormat ?? null
  );
  return { id: Number(inserted.lastInsertRowid), mimeType };
}

export function getImageById(
  id: number
): { id: number; sourceUrl: string; mimeType: string; content: Buffer; shotIndex: number | null; shotText: string | null; createdAt: string } | null {
  const row = getImageByIdStmt.get(id) as ImageRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    sourceUrl: row.source_url,
    mimeType: row.mime_type,
    content: row.content,
    shotIndex: row.shot_index,
    shotText: row.shot_text,
    createdAt: row.created_at
  };
}

export function getVideoById(
  id: number
): {
  id: number;
  sourceUrl: string;
  mimeType: string;
  content: Buffer;
  imageId: number | null;
  shotIndex: number | null;
  shotText: string | null;
  taskId: string | null;
  model: string | null;
  mode: string | null;
  sound: string | null;
  requestedSeconds: string | null;
  requestedSize: string | null;
  resultDuration: string | null;
  resultSize: string | null;
  resultFormat: string | null;
  createdAt: string;
} | null {
  const row = getVideoByIdStmt.get(id) as VideoRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    sourceUrl: row.source_url,
    mimeType: row.mime_type,
    content: row.content,
    imageId: row.image_id,
    shotIndex: row.shot_index,
    shotText: row.shot_text,
    taskId: row.task_id,
    model: row.model,
    mode: row.mode,
    sound: row.sound,
    requestedSeconds: row.requested_seconds,
    requestedSize: row.requested_size,
    resultDuration: row.result_duration,
    resultSize: row.result_size,
    resultFormat: row.result_format,
    createdAt: row.created_at
  };
}

export function getVideosByIds(ids: number[]): Array<{
  id: number;
  sourceUrl: string;
  mimeType: string;
  imageId: number | null;
  shotIndex: number | null;
  shotText: string | null;
  taskId: string | null;
  model: string | null;
  mode: string | null;
  sound: string | null;
  requestedSeconds: string | null;
  requestedSize: string | null;
  resultDuration: string | null;
  resultSize: string | null;
  resultFormat: string | null;
  createdAt: string;
}> {
  const out: Array<{
    id: number;
    sourceUrl: string;
    mimeType: string;
    imageId: number | null;
    shotIndex: number | null;
    shotText: string | null;
    taskId: string | null;
    model: string | null;
    mode: string | null;
    sound: string | null;
    requestedSeconds: string | null;
    requestedSize: string | null;
    resultDuration: string | null;
    resultSize: string | null;
    resultFormat: string | null;
    createdAt: string;
  }> = [];
  for (const id of ids) {
    const row = getVideoByIdsStmt.get(id) as Omit<VideoRow, "content"> | undefined;
    if (!row) continue;
    out.push({
      id: row.id,
      sourceUrl: row.source_url,
      mimeType: row.mime_type,
      imageId: row.image_id,
      shotIndex: row.shot_index,
      shotText: row.shot_text,
      taskId: row.task_id,
      model: row.model,
      mode: row.mode,
      sound: row.sound,
      requestedSeconds: row.requested_seconds,
      requestedSize: row.requested_size,
      resultDuration: row.result_duration,
      resultSize: row.result_size,
      resultFormat: row.result_format,
      createdAt: row.created_at
    });
  }
  return out;
}

export function listResources(limit = 200): ResourceItem[] {
  const images = (
    listImagesStmt.all(limit) as Array<{ id: number; source_url: string; shot_index: number | null; shot_text: string | null; created_at: string }>
  ).map((it) => ({
    kind: "image" as const,
    type: "image" as const,
    id: it.id,
    localUrl: `/api/images/${it.id}`,
    sourceUrl: it.source_url,
    shotIndex: it.shot_index,
    shotText: it.shot_text,
    createdAt: it.created_at
  }));

  const videos = (
    listVideosStmt.all(limit) as Array<{
      id: number;
      source_url: string;
      image_id: number | null;
      shot_index: number | null;
      shot_text: string | null;
      task_id: string | null;
      model: string | null;
      mode: string | null;
      sound: string | null;
      requested_seconds: string | null;
      requested_size: string | null;
      result_duration: string | null;
      result_size: string | null;
      result_format: string | null;
      created_at: string;
    }>
  ).map((it) => ({
    kind: "video" as const,
    type: "video" as const,
    id: it.id,
    localUrl: `/api/videos/${it.id}`,
    sourceUrl: it.source_url,
    shotIndex: it.shot_index,
    shotText: it.shot_text,
    createdAt: it.created_at,
    meta: {
      imageId: it.image_id,
      taskId: it.task_id,
      model: it.model,
      mode: it.mode,
      sound: it.sound,
      requestedSeconds: it.requested_seconds,
      requestedSize: it.requested_size,
      resultDuration: it.result_duration,
      resultSize: it.result_size,
      resultFormat: it.result_format
    }
  }));

  return [...images, ...videos].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}

export function deleteImageById(id: number): boolean {
  const r = deleteImageByIdStmt.run(id);
  return r.changes > 0;
}

export function deleteVideoById(id: number): boolean {
  const r = deleteVideoByIdStmt.run(id);
  return r.changes > 0;
}
