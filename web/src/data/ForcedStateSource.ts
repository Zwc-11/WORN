import { DataError, type Dossier, type Frames, type Product } from './contract';
import type { DataSource } from './DataSource';

export type ForcedState = 'loading' | 'failed' | 'none' | 'thin';

export function forcedStateFromUrl(search = window.location.search): ForcedState | null {
  const v = new URLSearchParams(search).get('state');
  return v === 'loading' || v === 'failed' || v === 'none' || v === 'thin' ? v : null;
}

/** Dev/demo wrapper: ?state=loading|failed|none|thin forces one designed state. Not part of the contract. */
export class ForcedStateSource implements DataSource {
  constructor(private readonly inner: DataSource, private readonly state: ForcedState) {}

  listProducts = (): Promise<Product[]> => this.inner.listProducts();
  getProduct = (id: string): Promise<Product> => this.inner.getProduct(id);

  async getDossier(id: string): Promise<Dossier> {
    switch (this.state) {
      case 'loading':
        return new Promise(() => {}); // never settles
      case 'failed':
        await delay(400);
        throw new DataError('failed', 'forced');
      case 'none':
        throw new DataError('none', 'forced');
      case 'thin': {
        const d = await this.inner.getDossier(id);
        const cases = d.cases.slice(0, 2);
        return { ...d, cases, counts: recount(cases, d) };
      }
    }
  }

  getFrames = (id: string): Promise<Frames> => this.inner.getFrames(id);
}

function recount(cases: Dossier['cases'], d: Dossier): Dossier['counts'] {
  const byType = Object.fromEntries(Object.keys(d.counts.byType).map((k) => [k, 0])) as Dossier['counts']['byType'];
  const byRegion = Object.fromEntries(Object.keys(d.counts.byRegion).map((k) => [k, 0])) as Dossier['counts']['byRegion'];
  for (const c of cases) {
    byType[c.type]++;
    byRegion[c.region]++;
  }
  return { byType, byRegion };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
