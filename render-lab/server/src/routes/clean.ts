// POST /api/clean/garment: turn an owner photo (Reddit, review photo) into a clean garment-only
// reference that VTON can use. Decart's VTON guide: "If the source is a model photo, extract the
// garment with an image editing model first." This route does that with lucy-image-2 on the server
// (the key never reaches the browser) and saves both the original and the results under
// web/public/fixtures/uploads/<productId>/ so they can be reused and audited.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { createDecartClient, models } from '@decartai/sdk';

export interface CleanDeps {
  apiKey?: string;
  publicDir: string;
  allowedOrigins: string[];
  /** Injected in tests; defaults to lucy-image-2 via the SDK. */
  edit?: (input: { data: Blob; prompt: string; seed: number }) => Promise<Blob>;
  seeds?: number[];
}

const MAX_BYTES = 12 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

export function cleanPrompt(noun: string): string {
  return (
    `Extract only the ${noun} from this photo and show it alone as a clean product photo: front view, laid flat and facing the camera, ` +
    `the whole garment visible and centered, on a plain light grey background, with no person, no hands and no other objects. ` +
    `Keep its exact color, knit texture and every visible sign of wear, pilling and damage exactly as in the photo.`
  );
}

/**
 * Size as an image instead of text: edit a photo of a person wearing the garment so it fits like
 * another size. Used as the VTON reference, the fit travels in the image and the prompt text stays
 * byte-identical across sizes (text changes make VTON redraw the whole garment).
 */
export function fitPrompt(noun: string, fit: string): string {
  return (
    `Change only how the ${noun} this person is wearing fits, so it looks ${fit}. ` +
    `Everything else stays exactly the same: the same person, face, hair, pose, hands, background, lighting and framing, ` +
    `and the same ${noun} with the same color, knit texture, collar, zipper, pocket and logo.`
  );
}

export function cleanRoutes(deps: CleanDeps) {
  const app = new Hono();
  const edit =
    deps.edit ??
    (deps.apiKey
      ? ((client) => (i: { data: Blob; prompt: string; seed: number }) =>
          client.process({ model: models.image('lucy-image-2'), prompt: i.prompt, data: i.data, seed: i.seed, resolution: '720p', enhance_prompt: false }))(
          createDecartClient({ apiKey: deps.apiKey }),
        )
      : undefined);

  app.post('/garment', async (c) => {
    const origin = c.req.header('origin');
    if (origin && deps.allowedOrigins.length > 0 && !deps.allowedOrigins.includes(origin))
      return c.json({ error: { code: 'ORIGIN', message: `origin ${origin} not allowed` } }, 403);
    if (!edit) return c.json({ error: { code: 'NO_KEY', message: 'Server has no DECART_API_KEY.' } }, 503);

    const body = await c.req.parseBody();
    const file = body['image'];
    const productId = String(body['productId'] ?? '');
    const noun = String(body['noun'] ?? 'garment').slice(0, 60);
    if (!(file instanceof File)) return c.json({ error: { code: 'NO_IMAGE', message: 'send the photo as form field "image"' } }, 400);
    if (!/^[a-z0-9-]{1,64}$/.test(productId)) return c.json({ error: { code: 'BAD_PRODUCT', message: 'productId must be [a-z0-9-]' } }, 400);
    if (!TYPES[file.type]) return c.json({ error: { code: 'BAD_TYPE', message: `use jpg, png or webp (got ${file.type || 'unknown'})` } }, 415);
    if (file.size > MAX_BYTES) return c.json({ error: { code: 'TOO_BIG', message: 'image over 12 MB' } }, 413);

    const dir = resolve(deps.publicDir, 'fixtures', 'uploads', productId);
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const bytes = Buffer.from(await file.arrayBuffer());
    const originalName = `${stamp}-original${TYPES[file.type]}`;
    writeFileSync(resolve(dir, originalName), bytes);
    const url = (name: string) => `/fixtures/uploads/${productId}/${name}`;

    const prompt = cleanPrompt(noun);
    const cleaned: string[] = [];
    const errors: string[] = [];
    // Decart runs one image job per key at a time, so sequential is as fast as parallel here.
    for (const seed of deps.seeds ?? [31, 32]) {
      try {
        const out = await edit({ data: new Blob([bytes], { type: file.type }), prompt, seed });
        const name = `${stamp}-clean-${seed}${out.type.includes('png') ? '.png' : '.jpg'}`;
        writeFileSync(resolve(dir, name), Buffer.from(await out.arrayBuffer()));
        cleaned.push(url(name));
      } catch (e) {
        errors.push(`seed ${seed}: ${(e as { message?: string })?.message ?? String(e)}`);
      }
    }
    if (cleaned.length === 0) return c.json({ error: { code: 'CLEAN_FAILED', message: errors.join('; ') } }, 502);
    return c.json({ original: url(originalName), cleaned, prompt, errors });
  });

  // POST /fit: multipart image (a person wearing the garment), productId, noun, size, fit (text from fitFor), seed?
  app.post('/fit', async (c) => {
    const origin = c.req.header('origin');
    if (origin && deps.allowedOrigins.length > 0 && !deps.allowedOrigins.includes(origin))
      return c.json({ error: { code: 'ORIGIN', message: `origin ${origin} not allowed` } }, 403);
    if (!edit) return c.json({ error: { code: 'NO_KEY', message: 'Server has no DECART_API_KEY.' } }, 503);
    const body = await c.req.parseBody();
    const file = body['image'];
    const productId = String(body['productId'] ?? '');
    const noun = String(body['noun'] ?? 'garment').slice(0, 60);
    const size = String(body['size'] ?? '');
    const fit = String(body['fit'] ?? '').slice(0, 400);
    const seed = Number(body['seed'] ?? 7) || 7;
    if (!(file instanceof File)) return c.json({ error: { code: 'NO_IMAGE', message: 'send the photo as form field "image"' } }, 400);
    if (!/^[a-z0-9-]{1,64}$/.test(productId)) return c.json({ error: { code: 'BAD_PRODUCT', message: 'productId must be [a-z0-9-]' } }, 400);
    if (!/^[A-Z]{1,4}$/.test(size) || !fit) return c.json({ error: { code: 'BAD_SIZE', message: 'send size (e.g. XL) and fit text' } }, 400);
    if (!TYPES[file.type]) return c.json({ error: { code: 'BAD_TYPE', message: `use jpg, png or webp (got ${file.type || 'unknown'})` } }, 415);
    if (file.size > MAX_BYTES) return c.json({ error: { code: 'TOO_BIG', message: 'image over 12 MB' } }, 413);

    const dir = resolve(deps.publicDir, 'fixtures', 'uploads', productId);
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const bytes = Buffer.from(await file.arrayBuffer());
    const originalName = `${stamp}-fit-base${TYPES[file.type]}`;
    writeFileSync(resolve(dir, originalName), bytes);
    const url = (name: string) => `/fixtures/uploads/${productId}/${name}`;
    const prompt = fitPrompt(noun, fit);
    try {
      const out = await edit({ data: new Blob([bytes], { type: file.type }), prompt, seed });
      const name = `${stamp}-fit-${size}-${seed}${out.type.includes('png') ? '.png' : '.jpg'}`;
      writeFileSync(resolve(dir, name), Buffer.from(await out.arrayBuffer()));
      return c.json({ original: url(originalName), image: url(name), size, prompt });
    } catch (e) {
      return c.json({ error: { code: 'FIT_FAILED', message: (e as { message?: string })?.message ?? String(e) } }, 502);
    }
  });

  return app;
}
