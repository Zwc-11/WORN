// Browser-side image prep. lucy-image-2 outputs 1280x720 and crops anything that isn't 16:9, so
// photos are letterboxed onto a 16:9 canvas first (measured: a square product photo lost its collar
// and hem without this).
export async function padTo16x9(file: Blob, background = '#f3f4ef', maxW = 1920): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const W = maxW;
  const H = Math.round((W * 9) / 16);
  const scale = Math.min(W / bmp.width, H / bmp.height);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
  bmp.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('canvas export failed'))), 'image/jpeg', 0.92));
}

export interface CleanResult {
  original: string;
  cleaned: string[];
  prompt: string;
  errors: string[];
}

/** Server route (lucy-image-2): extract the garment from an owner photo onto a plain background. */
export async function cleanGarment(file: Blob, productId: string, noun: string): Promise<CleanResult> {
  const form = new FormData();
  form.append('image', await padTo16x9(file), 'owner.jpg');
  form.append('productId', productId);
  form.append('noun', noun);
  const res = await fetch('/api/clean/garment', { method: 'POST', body: form });
  const body = (await res.json().catch(() => ({}))) as Partial<CleanResult> & { error?: { code: string; message: string } };
  if (!res.ok || !body.cleaned) throw new Error(body.error ? `${body.error.code}: ${body.error.message}` : `clean failed (${res.status})`);
  return body as CleanResult;
}
