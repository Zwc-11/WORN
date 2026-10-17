import { useEffect, useMemo, useState } from 'react';
import { createDataSource, type Product } from '../data';
import { ProductStrip } from '../modules/picker/ProductStrip';
import { ProductView } from './ProductView';
import './app.css';

const source = createDataSource();

function productFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('product');
}

export function App() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(productFromUrl);
  const [t, setT] = useState(0);

  useEffect(() => {
    source.listProducts().then(setProducts).catch(() => setListFailed(true));
  }, []);

  // Keep ?product= in the URL so a refresh lands on the same hoodie; ?state= is preserved.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set('product', selectedId);
    else url.searchParams.delete('product');
    window.history.replaceState(null, '', url);
  }, [selectedId]);

  const select = (id: string) => {
    if (id === selectedId) return;
    setT(0);
    const run = () => setSelectedId(id);
    if (document.startViewTransition) document.startViewTransition(run);
    else run();
  };

  const selected = useMemo(() => products?.find((p) => p.id === selectedId) ?? null, [products, selectedId]);

  return (
    <div className="app">
      <header className="app__header">
        <a className="app__wordmark" href="/" aria-label="WORN home">WORN</a>
        <p className="app__tagline">What owners saw later, drawn on the garment. Tap a mark for their photo and words.</p>
      </header>
      <ProductStrip products={products} failed={listFailed} selectedId={selectedId} onSelect={select} compact={!!selected} />
      {selected ? (
        <ProductView key={selected.id} source={source} product={selected} others={(products ?? []).filter((p) => p.id !== selected.id)} t={t} onT={setT} />
      ) : (
        <section className="app__empty" aria-live="polite">
          <p className="app__empty-line">Pick a hoodie to see what its owners reported.</p>
        </section>
      )}
    </div>
  );
}
