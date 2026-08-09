const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_DIMENSION = 10_000;
const MAX_OUTPUT_DIMENSION = 2_400;

export const ACCEPTED_SOURCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif'
] as const;

export type AcceptedSourceMimeType = (typeof ACCEPTED_SOURCE_MIME_TYPES)[number];

export interface CloudflareImageInfo {
  format: string;
  fileSize: number;
  width: number;
  height: number;
}

interface CloudflareImageOutput {
  response(): Response;
}

interface CloudflareImageTransform {
  transform(options: {
    width?: number;
    height?: number;
    fit?: 'scale-down' | 'contain' | 'cover' | 'crop' | 'pad';
  }): CloudflareImageTransform;
  output(options: {
    format: 'image/webp';
    quality: number;
    anim: boolean;
  }): Promise<CloudflareImageOutput>;
}

export interface CloudflareImagesBinding {
  info(stream: ReadableStream<Uint8Array>): Promise<CloudflareImageInfo>;
  input(stream: ReadableStream<Uint8Array>): CloudflareImageTransform;
}

export function cloudflareImagesBinding(
  platform: App.Platform | undefined
): CloudflareImagesBinding | undefined {
  return (platform?.env as unknown as { IMAGES?: CloudflareImagesBinding } | undefined)?.IMAGES;
}

export interface SanitizedImage {
  bytes: Uint8Array;
  contentHash: string;
  mimeType: 'image/webp';
  width: number;
  height: number;
}

export class ImageProcessingError extends Error {
  constructor(
    readonly code:
      | 'empty_file'
      | 'file_too_large'
      | 'unsupported_image'
      | 'mime_mismatch'
      | 'invalid_dimensions'
      | 'processor_unavailable'
      | 'processor_output_invalid',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ImageProcessingError';
  }
}

function normalizeCloudflareFormat(format: string): AcceptedSourceMimeType | null {
  const normalized = format.toLowerCase().replace(/^image\//u, '');
  if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'png') return 'image/png';
  if (normalized === 'webp') return 'image/webp';
  if (normalized === 'avif') return 'image/avif';
  return null;
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([ownedArrayBuffer(bytes)]).stream();
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ownedArrayBuffer(bytes));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function validateInfo(info: CloudflareImageInfo, stage: 'source' | 'output'): void {
  const maxDimension = stage === 'source' ? MAX_SOURCE_DIMENSION : MAX_OUTPUT_DIMENSION;
  if (
    !Number.isInteger(info.width) ||
    !Number.isInteger(info.height) ||
    info.width < 1 ||
    info.height < 1 ||
    info.width > maxDimension ||
    info.height > maxDimension
  ) {
    throw new ImageProcessingError(
      stage === 'source' ? 'invalid_dimensions' : 'processor_output_invalid',
      `${stage} image dimensions are invalid`
    );
  }
}

/**
 * Cloudflare decodes the bytes and reports the actual format; the browser MIME
 * is never trusted. Output is always re-encoded as a non-animated WebP. Per
 * Cloudflare Images semantics, non-JPEG output discards all EXIF metadata.
 */
export async function sanitizeImage(
  binding: CloudflareImagesBinding | undefined,
  source: Uint8Array,
  declaredMimeType: string
): Promise<SanitizedImage> {
  if (!binding) {
    throw new ImageProcessingError('processor_unavailable', 'Cloudflare Images binding is unavailable');
  }
  if (source.byteLength < 1) throw new ImageProcessingError('empty_file', 'The image is empty');
  if (source.byteLength > MAX_SOURCE_BYTES) {
    throw new ImageProcessingError('file_too_large', 'The image exceeds 10 MB');
  }
  if (!ACCEPTED_SOURCE_MIME_TYPES.includes(declaredMimeType as AcceptedSourceMimeType)) {
    throw new ImageProcessingError('unsupported_image', 'The declared image type is not supported');
  }

  let sourceInfo: CloudflareImageInfo;
  try {
    sourceInfo = await binding.info(bytesToStream(source));
  } catch (cause) {
    throw new ImageProcessingError('unsupported_image', 'The file could not be decoded as an image', {
      cause
    });
  }
  validateInfo(sourceInfo, 'source');
  const detectedMimeType = normalizeCloudflareFormat(sourceInfo.format);
  if (!detectedMimeType) {
    throw new ImageProcessingError('unsupported_image', 'The detected image type is not supported');
  }
  if (detectedMimeType !== declaredMimeType) {
    throw new ImageProcessingError('mime_mismatch', 'The declared and detected image types differ');
  }

  let response: Response;
  try {
    response = (
      await binding
        .input(bytesToStream(source))
        .transform({ width: MAX_OUTPUT_DIMENSION, height: MAX_OUTPUT_DIMENSION, fit: 'scale-down' })
        .output({ format: 'image/webp', quality: 88, anim: false })
    ).response();
  } catch (cause) {
    throw new ImageProcessingError('processor_output_invalid', 'The image could not be sanitized', {
      cause
    });
  }
  if (!response.ok || !response.body) {
    throw new ImageProcessingError('processor_output_invalid', 'The image processor returned no output');
  }

  const outputBytes = new Uint8Array(await response.arrayBuffer());
  if (outputBytes.byteLength < 1 || outputBytes.byteLength > MAX_SOURCE_BYTES) {
    throw new ImageProcessingError('processor_output_invalid', 'The sanitized image size is invalid');
  }

  const outputInfo = await binding.info(bytesToStream(outputBytes));
  validateInfo(outputInfo, 'output');
  if (normalizeCloudflareFormat(outputInfo.format) !== 'image/webp') {
    throw new ImageProcessingError('processor_output_invalid', 'The sanitized output is not WebP');
  }

  return {
    bytes: outputBytes,
    contentHash: await sha256(outputBytes),
    mimeType: 'image/webp',
    width: outputInfo.width,
    height: outputInfo.height
  };
}

export const sanitizeListingImage = sanitizeImage;
