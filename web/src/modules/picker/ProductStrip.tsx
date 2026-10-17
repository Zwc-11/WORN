import type { Product } from '../../data';
import { formatPrice } from '../product/format';
import './product-strip.css';

interface Props {
  products: Product[] | null;
  failed: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  compact: boolean;
}

const BADGE: Record<Product['evidence'], string> = { live: 'Owner reports', sample: 'Sample data', none: 'No reports' };

/** Three cards. When one is chosen the strip collapses to a compact row so switching stays one click. */
export function ProductStrip({ products, failed, selectedId, onSelect, compact }: Props) {
  return (
    <nav className={`strip ${compact ? 'strip--compact' : ''}`} aria-label="Products">
      {failed && <p className="strip__note">We couldn't load the product list.</p>}
      {!products && !failed && <p className="strip__note" aria-busy="true">Loading products</p>}
      {products && (
        <ul className="strip__list">
          {products.map((p) => {
            const active = p.id === selectedId;
            return (
              <li key={p.id}>
                <button
                  className={`card ${active ? 'card--active' : ''}`}
                  onClick={() => onSelect(p.id)}
                  aria-pressed={active}
                  aria-label={`${p.brand} ${p.name}, ${p.price ? formatPrice(p.price) : 'price unknown'}, ${BADGE[p.evidence]}`}
                  style={{ viewTransitionName: active ? 'none' : `card-${p.id}` } as React.CSSProperties}
                >
                  <span className="card__img-wrap">
                    <img className="card__img" src={p.image.hero} alt="" width={120} height={160} loading="eager" />
                  </span>
                  <span className="card__text">
                    <span className="card__brand">{p.brand}</span>
                    <span className="card__name">{p.name}</span>
                    <span className="card__meta mono">
                      {p.price ? formatPrice(p.price) : '—'}
                      <span className={`tag tag--${p.evidence}`}>{BADGE[p.evidence]}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
