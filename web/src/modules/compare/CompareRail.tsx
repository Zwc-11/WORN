import { useState } from 'react';
import { MIN_CASES_FOR_WEAR, type Axis, type DataSource, type Product } from '../../data';
import { useProductData } from '../../app/useProductData';
import { GarmentStage } from '../stage/GarmentStage';
import './compare-rail.css';

interface Props {
  source: DataSource;
  candidates: Product[];
  primaryAxis: Axis | null;
  t: number;
  onClose: () => void;
}

/** A second stage beside the first, sharing the one slider. Only honest when both products use the same axis. */
export function CompareRail({ source, candidates, primaryAxis, t, onClose }: Props) {
  const [id, setId] = useState<string | null>(candidates[0]?.id ?? null);
  const product = candidates.find((p) => p.id === id) ?? null;
  const data = useProductData(source, id);
  const thin = !!data.dossier && data.dossier.cases.length < MIN_CASES_FOR_WEAR;
  const sameAxis = !!data.dossier?.axis && data.dossier.axis === primaryAxis;

  return (
    <section className="compare" aria-label="Compare with another hoodie">
      <header className="compare__head">
        <label className="compare__pick">
          <span className="sr-only">Second hoodie</span>
          <select value={id ?? ''} onChange={(e) => setId(e.target.value)}>
            {candidates.map((p) => (<option key={p.id} value={p.id}>{p.brand} · {p.name}</option>))}
          </select>
        </label>
        <button type="button" className="compare__close" onClick={onClose} aria-label="Close compare">×</button>
      </header>
      {product && (
        <GarmentStage product={product} frames={data.frames} t={sameAxis ? t : 0} drawWear={data.status === 'ready' && !thin && sameAxis} />
      )}
      <p className="compare__note mono">
        {data.status === 'none' && 'No owner reports for this item yet'}
        {data.status === 'failed' && "We couldn't load owner reports."}
        {data.status === 'ready' && !sameAxis && data.dossier?.axis && `Owners of this one spoke in ${data.dossier.axis}; the slider can't be shared.`}
        {data.status === 'ready' && !sameAxis && !data.dossier?.axis && 'Owners reported wear but none said when.'}
        {data.status === 'ready' && sameAxis && thin && `Only ${data.dossier!.cases.length} reports, no wear drawn`}
        {data.status === 'ready' && sameAxis && !thin && `${data.dossier!.cases.length} wear reports in ${data.dossier!.reviewsRead.toLocaleString('en-US')} reviews read`}
      </p>
    </section>
  );
}
