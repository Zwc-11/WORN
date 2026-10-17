import { DataError, DossierSchema, FramesSchema, ProductListSchema, type Dossier, type Frames, type Product } from './contract';
import type { DataSource } from './DataSource';

/** Reads /fixtures/*.json served from web/public. Validated with zod on every read. */
export class FixtureSource implements DataSource {
  constructor(private readonly base = '/fixtures') {}

  private async json(path: string): Promise<unknown> {
    const res = await fetch(`${this.base}/${path}`);
    if (res.status === 404) throw new DataError('none', path);
    if (!res.ok) throw new DataError('failed', `${res.status} ${path}`);
    return res.json();
  }

  async listProducts(): Promise<Product[]> {
    return ProductListSchema.parse(await this.json('products.json'));
  }

  async getProduct(id: string): Promise<Product> {
    const p = (await this.listProducts()).find((x) => x.id === id);
    if (!p) throw new DataError('failed', `unknown product ${id}`);
    return p;
  }

  async getDossier(id: string): Promise<Dossier> {
    const p = await this.getProduct(id);
    if (p.evidence === 'none') throw new DataError('none');
    return DossierSchema.parse(await this.json(`${id}.dossier.json`));
  }

  async getFrames(id: string): Promise<Frames> {
    try {
      return FramesSchema.parse(await this.json(`${id}.frames.json`));
    } catch (e) {
      if (e instanceof DataError && e.kind === 'none') return photoOnlyFrames(await this.getProduct(id));
      throw e;
    }
  }
}

/** Frames with only the product photo, for a product with no generated stills. */
export function photoOnlyFrames(p: Product): Frames {
  return { productId: p.id, axis: 'months', stages: [{ t: 0, image: p.image.hero, basedOn: [] }], generated: true, label: 'illustration' };
}
