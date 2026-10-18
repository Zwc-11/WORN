// The live stage in a Plan v2-style layout, for rehearsing lane C on its own and showing A how to mount it.
// /stage.html?engine=mock|decart&model=lucy-vton-latest|lucy-2.5&strategy=reference-swap|prompt-only&product=<id>&auto=1&person=1
import { useEffect, useState } from 'react';
import type { Dossier, Frames, Product } from '../data/contract';
import { LiveGarmentStage } from '../modules/stage/LiveGarmentStage';
import { planTryOn } from '../render/wear/plan';
import type { ModelChoice, Strategy } from '../render/live/types';
import { FrozenPreview } from './FrozenPreview';
import { loadBundle, loadGarmentOverrides, loadPersonFrames, loadProducts } from './fixtures';
import type { GarmentOverride } from '../render/wear/prompts';
import './stage-demo.css';

export function StageDemo() {
  const q = new URLSearchParams(location.search);
  const [product, setProduct] = useState<Product | null>(null);
  const [data, setData] = useState<{ dossier: Dossier | null; frames: Frames | null; person: Frames | null; garment?: GarmentOverride } | null>(null);
  const [t, setT] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => {
    loadProducts()
      .then(async (ps) => {
        const p = ps.find((x) => x.id === q.get('product')) ?? ps[0];
        if (!p) throw new Error('no products in fixtures/products.json');
        setProduct(p);
        // ?person=1: the fallback shows the presenter wearing the aged hoodie (pipeline --person) instead of the flat garment
        const [b, person, overrides] = await Promise.all([loadBundle(p.id), q.get('person') === '1' ? loadPersonFrames(p.id) : null, loadGarmentOverrides()]);
        setData({ ...b, person, garment: overrides[p.id] });
      })
      .catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (err) return <p className="sd__err">{err}</p>;
  if (!product || !data) return null;
  const plan = planTryOn(product, data.dossier, data.frames, { garment: data.garment });
  const axis = plan.axis ?? 'washes';
  const maxT = plan.stages.at(-1)!.t;
  const d = data.dossier;

  return (
    <div className="sd">
      <div className="sd__stage">
        <LiveGarmentStage
          product={product}
          dossier={d}
          frames={data.frames}
          t={t}
          engine={(q.get('engine') as 'mock') ?? 'decart'}
          model={(q.get('model') as ModelChoice) ?? 'lucy-vton-latest'}
          strategy={(q.get('strategy') as Strategy) ?? 'reference-swap'}
          autoStart={q.get('auto') === '1'}
          garment={data.garment}
          fallback={<FrozenPreview frames={data.person ?? data.frames} t={t} fallbackImage={product.image.flat ?? product.image.hero} />}
        />
        <div className="sd__rail">
          <input
            type="range"
            min={0}
            max={maxT || 1}
            step={1}
            value={t}
            disabled={plan.evidence !== 'ok'}
            onChange={(e) => setT(Number(e.target.value))}
            aria-label={`time in ${axis}`}
            aria-valuetext={`${t} ${axis}`}
          />
          <div className="sd__ticks">
            {plan.stages.map((s) => (
              <span key={s.t} style={{ left: `${(s.t / (maxT || 1)) * 100}%` }}>
                {s.t}
              </span>
            ))}
          </div>
          <div className="sd__axis">
            {t} {axis}
          </div>
        </div>
      </div>
      <aside className="sd__info">
        {d?.sample && <span className="sd__tag">Sample data</span>}
        <h1>{product.name}</h1>
        <p className="sd__meta">
          {product.brand} · {product.material} · {product.color}
          {product.price ? ` · $${product.price.amount}` : ''}
        </p>
        {d && (
          <ul className="sd__counts">
            <li>{d.reviewsRead.toLocaleString()} reviews read</li>
            {Object.entries(d.counts.byType)
              .filter(([, n]) => n > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <li key={k}>
                  {n} report {k.replace('_', ' ')}
                </li>
              ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
