import { DataError, DossierSchema, FramesSchema, ProductListSchema, ProductSchema, type Dossier, type Frames, type Product } from './contract';
import type { DataSource } from './DataSource';

/**
 * P1 hook: same four shapes served by the Hono server. Routes mirror DataSource:
 *   GET /api/products            -> Product[]
 *   GET /api/products/:id        -> Product
 *   GET /api/products/:id/dossier-> Dossier   (404 => DataError('none'))
 *   GET /api/products/:id/frames -> Frames
 * Selected with VITE_SOURCE=http; no UI code changes.
 */
export class HttpSource implements DataSource {
  constructor(private readonly base = import.meta.env.VITE_API_BASE ?? '', private readonly timeoutMs = 8000) {}

  private async json(path: string): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.base}/api${path}`, { signal: ctrl.signal });
      if (res.status === 404) throw new DataError('none', path);
      if (!res.ok) throw new DataError('failed', `${res.status} ${path}`);
      return await res.json();
    } catch (e) {
      if (e instanceof DataError) throw e;
      throw new DataError('failed', e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
  }

  listProducts = async (): Promise<Product[]> => ProductListSchema.parse(await this.json('/products'));
  getProduct = async (id: string): Promise<Product> => ProductSchema.parse(await this.json(`/products/${id}`));
  getDossier = async (id: string): Promise<Dossier> => DossierSchema.parse(await this.json(`/products/${id}/dossier`));
  getFrames = async (id: string): Promise<Frames> => FramesSchema.parse(await this.json(`/products/${id}/frames`));
}
