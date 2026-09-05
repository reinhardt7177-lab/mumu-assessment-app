import { createHash, randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { AppError } from "./assessment-domain";

export const MAX_EVIDENCE_BYTES = 3_000_000;

const allowed = {
  photo: new Set(["image/jpeg", "image/png", "image/webp"]),
  speech: new Set(["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav"]),
  screen: new Set(["video/webm", "video/mp4"]),
} as const;

function normalizedMime(file: File) {
  return file.type.toLowerCase().split(";", 1)[0];
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function signatureMatches(bytes: Uint8Array, mime: string) {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG";
  if (mime === "image/webp") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
  if (mime === "audio/webm" || mime === "video/webm") return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (mime === "audio/mp4" || mime === "video/mp4") return ascii(bytes, 4, 4) === "ftyp";
  if (mime === "audio/mpeg") return ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (mime === "audio/wav") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";
  return false;
}

function extension(mime: string) {
  return ({
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "audio/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav",
    "video/webm": "webm", "video/mp4": "mp4",
  } as Record<string, string>)[mime];
}

export async function validateEvidenceFile(file: File, modality: "photo" | "speech" | "screen") {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new AppError(503, "비공개 사진·녹음 저장소 연결 준비 중입니다.");
  const mimeType = normalizedMime(file);
  if (!allowed[modality].has(mimeType as never)) {
    const message = modality === "photo" ? "JPG·PNG·WebP 사진만 올릴 수 있습니다." : modality === "speech" ? "WebM·M4A·MP3·WAV 녹음만 올릴 수 있습니다." : "WebM·MP4 화면 녹화만 올릴 수 있습니다.";
    throw new AppError(415, message);
  }
  if (file.size < 1 || file.size > MAX_EVIDENCE_BYTES) throw new AppError(413, "파일은 최대 3MB까지 올릴 수 있습니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!signatureMatches(bytes, mimeType)) throw new AppError(415, "파일 내용과 형식이 일치하지 않습니다.");
  return { bytes, mimeType, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function storePrivateEvidence(input: { attemptId: string; questionId: string; modality: "photo" | "speech" | "screen"; bytes: Uint8Array; mimeType: string }) {
  const pathname = `student-evidence/${input.attemptId}/${input.questionId}/${input.modality}-${randomUUID()}.${extension(input.mimeType)}`;
  const blob = await put(pathname, Buffer.from(input.bytes), { access: "private", contentType: input.mimeType, addRandomSuffix: false, cacheControlMaxAge: 60 });
  return { pathname: blob.pathname };
}

export async function removePrivateEvidence(pathname: string) {
  await del(pathname);
}

export async function readPrivateEvidence(pathname: string) {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) throw new AppError(404, "비공개 원본 파일을 찾을 수 없습니다.");
  return { bytes: new Uint8Array(await new Response(result.stream).arrayBuffer()), mimeType: result.blob.contentType || "application/octet-stream" };
}

export async function streamPrivateEvidence(pathname: string) {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) throw new AppError(404, "비공개 원본 파일을 찾을 수 없습니다.");
  return { stream: result.stream, mimeType: result.blob.contentType || "application/octet-stream", etag: result.blob.etag };
}
