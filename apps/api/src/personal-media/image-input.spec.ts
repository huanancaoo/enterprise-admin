import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { readImage } from './image-input';

function request(body: Buffer, contentType: string | undefined): Request {
  return Object.assign(Readable.from([body]), {
    get: () => contentType,
  }) as unknown as Request;
}

describe('personal image content admission', () => {
  it('rejects an image whose metadata is readable but pixel data is truncated', async () => {
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const truncated = png.subarray(0, png.length - 20);
    await expect(sharp(truncated).metadata()).resolves.toMatchObject({
      format: 'png',
    });
    await expect(
      readImage(request(truncated, 'image/png'), new AbortController().signal),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves the abort reason when cancellation interrupts image decoding', async () => {
    const png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const controller = new AbortController();
    const reason = new Error('request cancelled');
    const metadata = vi
      .spyOn(sharp.prototype, 'metadata')
      .mockImplementationOnce(() => {
        controller.abort(reason);
        throw new Error('decoder stopped');
      });
    try {
      await expect(
        readImage(request(png, 'image/png'), controller.signal),
      ).rejects.toBe(reason);
    } finally {
      metadata.mockRestore();
    }
  });

  it('accepts standard MIME whitespace while still verifying the actual image', async () => {
    const png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const result = await readImage(
      request(png, 'Image/PNG ; charset=utf-8'),
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      contentType: 'image/png',
      bytes: png.length,
      body: png,
    });
    await expect(
      readImage(request(png, 'image/jpeg'), new AbortController().signal),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([undefined, 'not-a-type', 'image/', 'image/svg+xml'])(
    'keeps missing, invalid and unsupported MIME %s as a client rejection',
    async (header) => {
      await expect(
        readImage(
          request(Buffer.alloc(0), header),
          new AbortController().signal,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
