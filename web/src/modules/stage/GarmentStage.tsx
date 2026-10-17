import { useEffect, useMemo, type RefObject } from 'react';
import type { Frames, Product } from '../../data';
import { frameFor } from '../../render/frameFor';
import './garment-stage.css';

interface Props {
  product: Product;
  frames: Frames | null;
  t: number;
  /** false in loading / failed / none / insufficient-evidence states: the photo alone is shown. */
  drawWear: boolean;
  children?: React.ReactNode;
  /** Measured by the parent to place markers on the contained image. */
  imgRef?: RefObject<HTMLImageElement>;
}

/** Two layered <img>; the top one's opacity is the mix between the two nearest stills. */
export function GarmentStage({ product, frames, t, drawWear, children, imgRef }: Props) {
  const pair = useMemo(() => (frames && drawWear ? frameFor(frames, t) : null), [frames, drawWear, t]);

  // Preload every stage so a drag never shows a blank.
  useEffect(() => {
    frames?.stages.forEach((s) => { const img = new Image(); img.src = s.image; });
  }, [frames]);

  const a = pair?.a ?? product.image.hero;
  const b = pair?.b ?? product.image.hero;
  const mix = pair?.mix ?? 0;
  const n = pair?.basedOn.length ?? 0;

  return (
    <figure className="stage" style={{ '--mix': mix } as React.CSSProperties}>
      <div className="stage__canvas" style={{ viewTransitionName: `card-${product.id}` } as React.CSSProperties}>
        <img ref={imgRef} className="stage__img stage__img--a" src={a} alt={`${product.brand} ${product.name}`} draggable={false} />
        <img className="stage__img stage__img--b" src={b} alt="" aria-hidden draggable={false} />
        {children}
      </div>
      <figcaption className="stage__caption mono">
        {n > 0 ? (
          <><span className="tag">Illustration</span> composed from {n} owner {n === 1 ? 'report' : 'reports'}</>
        ) : (
          <>Product photo</>
        )}
      </figcaption>
    </figure>
  );
}
