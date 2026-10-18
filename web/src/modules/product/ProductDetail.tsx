import type { Dossier, Product } from '../../data';
import { DAMAGE_TYPES, REGIONS } from '../../data';
import type { LoadStatus } from '../../app/useProductData';
import { REGION_LABEL, TYPE_LABEL, formatCount, formatPrice } from './format';
import './product-detail.css';

interface Props { product: Product; dossier: Dossier | null; status: LoadStatus }

const BADGE: Record<Product['evidence'], string> = { live: 'Owner reports', sample: 'Sample data', none: 'No reports' };

export function ProductDetail({ product: p, dossier, status }: Props) {
  const sample = dossier?.sample ?? p.evidence === 'sample';
  return (
    <aside className="detail">
      <header className="detail__head">
        <p className="detail__brand">{p.brand}</p>
        <h1 className="detail__name">{p.name}</h1>
        <div className="detail__tags">
          <span className={`tag tag--${p.evidence}`}>{BADGE[p.evidence]}</span>
          {sample && p.evidence !== 'sample' && <span className="tag tag--sample">Sample data</span>}
        </div>
        <div className={`detail__progress ${status === 'loading' ? 'detail__progress--on' : ''}`} role="progressbar" aria-hidden={status !== 'loading'} aria-label="Loading owner reports" />
      </header>

      <dl className="detail__facts">
        {p.material && (<><dt>Material</dt><dd>{p.material}</dd></>)}
        {p.color && (<><dt>Colour</dt><dd>{p.color}</dd></>)}
        {p.price && (<><dt>Price</dt><dd className="mono">{formatPrice(p.price)}</dd></>)}
        <dt>Listing</dt>
        <dd><a href={p.url} target="_blank" rel="noopener noreferrer">Product page ↗</a></dd>
      </dl>

      {dossier && <Counts dossier={dossier} />}
      {status === 'none' && <p className="detail__note">This site publishes no customer reviews, so there is nothing to show. We don't borrow reports from other items.</p>}
    </aside>
  );
}

function Counts({ dossier: d }: { dossier: Dossier }) {
  const types = DAMAGE_TYPES.filter((t) => d.counts.byType[t] > 0);
  const regions = REGIONS.filter((r) => d.counts.byRegion[r] > 0);
  return (
    <section className="counts" aria-label="Report counts">
      <p className="counts__lead">
        <span className="mono">{formatCount(d.cases.length)}</span> wear reports in{' '}
        <span className="mono">{formatCount(d.reviewsRead)}</span> reviews read,{' '}
        <span className="mono">{formatCount(d.reviewsWithPhotos)}</span> with photos.
      </p>
      <div className="counts__cols">
        <div className="counts__list">
          <h2 className="counts__title">By type</h2>
          <ul>{types.map((t) => (<li key={t} className="counts__row"><span>{TYPE_LABEL[t]}</span><span className="mono">{d.counts.byType[t]}</span></li>))}</ul>
        </div>
        <div className="counts__list">
          <h2 className="counts__title">By region</h2>
          <ul>{regions.map((r) => (<li key={r} className="counts__row"><span>{REGION_LABEL[r]}</span><span className="mono">{d.counts.byRegion[r]}</span></li>))}</ul>
        </div>
      </div>
    </section>
  );
}
