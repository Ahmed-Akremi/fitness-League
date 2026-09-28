import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators';
import { StorageService } from './storage.service';

/** Serves locally stored media (dev). Keys contain a content hash, so responses are immutable. */
@ApiExcludeController()
@Controller('media')
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get('*path')
  async get(@Req() req: Request, @Res() res: Response): Promise<void> {
    let key: string;
    try {
      key = decodeURIComponent(req.path.replace(/^.*?\/media\//, ''));
    } catch {
      throw new NotFoundException();
    }
    const file = await this.storage.read(key);
    if (!file) throw new NotFoundException();
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // helmet defaults to same-origin; the web app loads logos
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.bytes);
  }
}
