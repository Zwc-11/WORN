import { useMemo } from 'react';
import { MIN_CASES_FOR_WEAR, type DataSource, type Product } from '../data';
import { useProductData } from './useProductData';
import { GarmentStage } from '../modules/stage/GarmentStage';
import { TimeSlider, sliderRangeFor } from '../modules/slider/TimeSlider';
import { ProductDetail } from '../modules/product/ProductDetail';
import './product-view.css';

interface Props {
  source: DataSource;
  product: Product;
  t: number;
  onT: (t: number) => void;
}

/** One product on the stage with its detail column. Owns nothing but layout and the state switch. */
export function ProductView({ source, product, t, onT }: Props) {
  const data = useProductData(source, product.id);
  const dossier = data.dossier;
  const frames = data.frames;
  const thin = !!dossier && dossier.cases.length < MIN_CASES_FOR_WEAR;
  const range = useMemo(() => (dossier && frames ? sliderRangeFor(dossier, frames) : null), [dossier, frames]);

  return (
    <main className="pv">
      <section className="pv__stage" aria-label={`${product.brand} ${product.name} on the stage`}>
        <GarmentStage product={product} frames={frames} t={t} drawWear={data.status === 'ready' && !thin} />
        <div className="pv__rail">
          {data.status === 'ready' && dossier && range && dossier.axis ? (
            <TimeSlider axis={dossier.axis} range={range} value={t} onChange={onT} />
          ) : data.status === 'ready' && dossier && !dossier.axis ? (
            <p className="pv__rail-note">Owners reported wear but none said when. Marks are shown without a time.</p>
          ) : data.status === 'none' ? (
            <p className="pv__rail-note">No owner reports for this item yet</p>
          ) : data.status === 'failed' ? (
            <p className="pv__rail-note">
              We couldn't load owner reports. <button className="pv__retry" onClick={data.retry}>Retry</button>
            </p>
          ) : (
            <TimeSlider axis={null} range={{ max: 1, ticks: [0] }} value={0} onChange={() => {}} disabled />
          )}
        </div>
      </section>
      <ProductDetail product={product} dossier={dossier} status={data.status} />
    </main>
  );
}
