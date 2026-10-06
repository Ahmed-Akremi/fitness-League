import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { sniffImage } from '../gyms/gym-logo.service';
import { ANNOUNCEMENT_IMAGE_MAX_BYTES, ANNOUNCEMENT_IMAGE_MAX_WIDTH } from './announcement-rules';

export interface EncodedImage {
  webp: Buffer;
  width: number;
  height: number;
  sha256: Buffer;
}

/** Validates an uploaded photo (images only — never video) and re-encodes it as a WebP at most 1440 px wide. */
export async function encodeAnnouncementImage(file: { buffer: Buffer; size: number }): Promise<EncodedImage> {
  if (file.size > ANNOUNCEMENT_IMAGE_MAX_BYTES) throw new AppException(HttpStatus.PAYLOAD_TOO_LARGE, ErrorCode.PAYLOAD_TOO_LARGE, 'Photo must be 5 MB or less.');
  if (!sniffImage(file.buffer)) throw new AppException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Photo must be a PNG, JPEG or WebP image.');
  try {
    const { data, info } = await sharp(file.buffer, { limitInputPixels: 60_000_000 })
      .rotate()
      .resize({ width: ANNOUNCEMENT_IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return { webp: data, width: info.width, height: info.height, sha256: createHash('sha256').update(data).digest() };
  } catch {
    throw new AppException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Photo could not be decoded.');
  }
}
