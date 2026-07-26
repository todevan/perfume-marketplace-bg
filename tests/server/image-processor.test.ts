import { describe, expect, it, vi } from 'vitest';
import {
  ImageProcessingError,
  sanitizeListingImage,
  type CloudflareImagesBinding
} from '../../src/lib/server/uploads/image-processor';

function fakeBinding(sourceFormat = 'jpeg') {
  const info = vi
    .fn()
    .mockResolvedValueOnce({ format: sourceFormat, fileSize: 4, width: 1200, height: 900 })
    .mockResolvedValueOnce({ format: 'webp', fileSize: 3, width: 1200, height: 900 });
  const output = vi.fn(async () => ({ response: () => new Response(new Uint8Array([8, 9, 10])) }));
  const transform = vi.fn();
  const chain = { transform, output };
  transform.mockReturnValue(chain);
  const input = vi.fn(() => chain);

  return { binding: { info, input } as unknown as CloudflareImagesBinding, info, input, transform, output };
}

describe('trusted listing image processor', () => {
  it('detects the real source type and emits a bounded non-animated WebP', async () => {
    const processor = fakeBinding();
    const result = await sanitizeListingImage(
      processor.binding,
      new Uint8Array([1, 2, 3, 4]),
      'image/jpeg'
    );

    expect(result.mimeType).toBe('image/webp');
    expect(result.width).toBe(1200);
    expect(result.height).toBe(900);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(processor.transform).toHaveBeenCalledWith({
      width: 2400,
      height: 2400,
      fit: 'scale-down'
    });
    expect(processor.output).toHaveBeenCalledWith({
      format: 'image/webp',
      quality: 88,
      anim: false
    });
  });

  it('rejects a browser MIME that differs from decoded content', async () => {
    const processor = fakeBinding('png');
    await expect(
      sanitizeListingImage(processor.binding, new Uint8Array([1, 2, 3]), 'image/jpeg')
    ).rejects.toMatchObject({ code: 'mime_mismatch' });
  });

  it('fails closed when the production processor binding is absent', async () => {
    await expect(
      sanitizeListingImage(undefined, new Uint8Array([1]), 'image/jpeg')
    ).rejects.toBeInstanceOf(ImageProcessingError);
  });
});
