import { useCallback, useEffect, useState } from 'react';
import { DataError, type DataSource, type Dossier, type Frames, type Product } from '../data';
import { photoOnlyFrames } from '../data/FixtureSource';

export type LoadStatus = 'loading' | 'ready' | 'failed' | 'none';

export interface ProductData {
  product: Product | null;
  dossier: Dossier | null;
  frames: Frames | null;
  status: LoadStatus;
  retry: () => void;
}

/** Loads product, dossier and frames for one id. Status follows Plan v2's state table. */
export function useProductData(source: DataSource, id: string | null): ProductData {
  const [product, setProduct] = useState<Product | null>(null);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [frames, setFrames] = useState<Frames | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setStatus('loading');
    setDossier(null);
    setFrames(null);
    (async () => {
      let p: Product;
      try {
        p = await source.getProduct(id);
        if (!alive) return;
        setProduct(p);
      } catch {
        if (alive) setStatus('failed');
        return;
      }
      const [d, f] = await Promise.allSettled([source.getDossier(id), source.getFrames(id)]);
      if (!alive) return;
      if (d.status === 'rejected') {
        const kind = d.reason instanceof DataError ? d.reason.kind : 'failed';
        setFrames(photoOnlyFrames(p));
        setStatus(kind);
        return;
      }
      setDossier(d.value);
      setFrames(f.status === 'fulfilled' ? f.value : photoOnlyFrames(p));
      setStatus('ready');
    })();
    return () => { alive = false; };
  }, [source, id, attempt]);

  return { product, dossier, frames, status, retry };
}
