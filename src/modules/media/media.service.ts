import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 15 * 1024 * 1024; // 15 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB

@Injectable()
export class MediaService {
  private readonly storage: Storage;
  private readonly bucketName: string;
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly config: ConfigService) {
    const keyFile = config.get<string>('GCP_KEY_FILE');
    const keyJson = config.get<string>('GCP_KEY_JSON');

    this.storage = new Storage({
      projectId: config.get<string>('GCP_PROJECT_ID'),
      ...(keyJson
        ? { credentials: JSON.parse(keyJson) as Record<string, unknown> }
        : { keyFilename: keyFile }),
    });
    this.bucketName = config.get<string>('GCP_BUCKET_NAME')!;
  }

  // ─── UPLOAD SINGLE ───────────────────────────────────────────────────────────

  async uploadFile(
    file: Express.Multer.File,
    folder: string,
  ): Promise<string> {
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('File type not allowed. Use JPG, PNG, WebP or MP4');
    }

    if (IMAGE_TYPES.includes(file.mimetype) && file.size > MAX_IMAGE_SIZE) {
      throw new BadRequestException('Photo too large. Maximum size is 15MB');
    }

    if (file.mimetype === 'video/mp4' && file.size > MAX_VIDEO_SIZE) {
      throw new BadRequestException('Video too large. Maximum size is 100MB');
    }

    const filename = uuid() + path.extname(file.originalname);
    const filePath = `${folder}/${filename}`;
    const bucket = this.storage.bucket(this.bucketName);
    const gcpFile = bucket.file(filePath);

    await gcpFile.save(file.buffer, { contentType: file.mimetype });
    await gcpFile.makePublic();

    return `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
  }

  // ─── UPLOAD MULTIPLE ─────────────────────────────────────────────────────────

  async uploadMultiple(
    files: Express.Multer.File[],
    folder: string,
  ): Promise<string[]> {
    return Promise.all(files.map((f) => this.uploadFile(f, folder)));
  }

  // ─── DELETE ──────────────────────────────────────────────────────────────────

  async deleteFile(url: string): Promise<void> {
    try {
      // URL format: https://storage.googleapis.com/{bucket}/{path}
      const prefix = `https://storage.googleapis.com/${this.bucketName}/`;
      if (!url.startsWith(prefix)) {
        throw new BadRequestException('Invalid GCP URL');
      }
      const filePath = url.slice(prefix.length);
      await this.storage.bucket(this.bucketName).file(filePath).delete();
    } catch (err) {
      this.logger.error(`deleteFile failed for ${url}`, err);
      throw err;
    }
  }
}
