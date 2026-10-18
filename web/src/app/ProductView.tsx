import { useCallback, useMemo, useRef, useState } from 'react';
import { MIN_CASES_FOR_WEAR, compareEnabled, liveEnabled, type DataSource, type Product, type Region } from '../data';
import { useProductData } from './useProductData';
import { pinsFor } from '../render/pinsFor';
import { GarmentStage } from '../modules/stage/GarmentStage';
import { LiveStage } from '../modules/stage/LiveStage';
import { useContainedBox } from '../modules/stage/useContainedBox';
import { TimeSlider, sliderRangeFor } from '../modules/slider/TimeSlider';
import { DamageMarkers } from '../modules/markers/DamageMarkers';
import { EvidenceDrawer } from '../modules/evidence/EvidenceDrawer';
import { ProductDetail } from '../modules/product/ProductDetail';
import { CompareRail } from '../modules/compare/CompareRail';
import './product-view.css';

interface Props {
  source: DataSource;
  product: Product;
  others: Product[];
  t: number;
  onT: (t: number) => void;
}

/** One product on the stage with its detail column. Owns the state switch, the open pin and the compare flag. */
export function ProductView({ source, product, others, t, onT }: Props) {
  const data = useProductData(source, product.id);
  const { dossier, frames } = data;
  const thin = !!dossier && dossier.cases.length < MIN_CASES_FOR_WEAR;
  const axis = dossier?.axis ?? null;
  const range = useMemo(() => (dossier && frames ? sliderRangeFor(dossier, frames) : null), [dossier, frames]);
  const pins = useMemo(() => (dossier ? pinsFor(dossier, t) : []), [dossier, t]);

  const [openRegion, setOpenRegion] = useState<Region | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openPin = pins.find((p) => p.region === openRegion) ?? null;
  const open = (region: Region) => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpenRegion(region);
  };
  const close = useCallback(() => setOpenRegion(null), []);

  const [comparing, setComparing] = useState(false);

  // Live try-on (P2 slot): the same stage inputs, a different renderer. Off unless VITE_LIVE=1.
  const [live, setLive] = useState(false);
  const [liveStill, setLiveStill] = useState<string | null>(null);
  const tryOnRef = useRef<HTMLButtonElement>(null);
  const exitLive = useCallback(() => {
    setLive(false);
    setLiveStill(null);
    requestAnimationFrame(() => tryOnRef.current?.focus());
  }, []);

  const imgRef = useRef<HTMLImageElement>(null);
  // Re-measured when the stage's image changes: the hero, or the photo taken on the live stage.
  const box = useContainedBox(imgRef, live ? liveStill ?? '' : product.image.hero);

  const drawWear = data.status === 'ready' && !thin;
  const markers = data.status === 'ready' && dossier && (
    <DamageMarkers product={product} pins={pins} axis={axis} box={box} thin={thin} activeRegion={openRegion} onOpen={open} />
  );

  return (
    <main className={`pv ${comparing ? 'pv--compare' : ''}`}>
      <section className="pv__stage" aria-label={`${product.brand} ${product.name} on the stage`}>
        {live ? (
          <LiveStage product={product} frames={frames} t={t} drawWear={drawWear} imgRef={imgRef} onStill={setLiveStill} onExit={exitLive}>
            {markers}
          </LiveStage>
        ) : (
          <GarmentStage product={product} frames={frames} t={t} drawWear={drawWear} imgRef={imgRef}>
            {markers}
          </GarmentStage>
        )}
        {liveEnabled && !live && !comparing && (
          <button ref={tryOnRef} type="button" className="pv__tryon-btn" onClick={() => setLive(true)}>Try it on</button>
        )}
        <div className="pv__rail">
          {data.status === 'ready' && dossier && range && axis ? (
            <TimeSlider axis={axis} range={range} value={t} onChange={onT} />
          ) : data.status === 'ready' && dossier && !axis ? (
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
          {compareEnabled && !comparing && !live && others.length > 0 && data.status === 'ready' && (
            <button type="button" className="pv__compare-btn" onClick={() => setComparing(true)}>Compare</button>
          )}
        </div>
      </section>

      {comparing && (
        <CompareRail source={source} candidates={others} primaryAxis={axis} t={t} onClose={() => setComparing(false)} />
      )}

      <ProductDetail product={product} dossier={dossier} status={data.status} />

      {dossier && (
        <EvidenceDrawer pin={openPin} dossier={dossier} axis={axis} thin={thin} onClose={close} returnFocusTo={openerRef.current} />
      )}
    </main>
  );
}
