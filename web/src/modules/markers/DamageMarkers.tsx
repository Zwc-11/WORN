import type { Axis, Product, Region } from '../../data';
import type { Pin } from '../../render/pinsFor';
import type { Box } from '../stage/useContainedBox';
import { REGION_LABEL, TYPE_LABEL, formatT } from '../product/format';
import './damage-markers.css';

/** Generic hoodie map used when product.image.regions is absent. Percent of the hero image. */
const DEFAULT_REGIONS: Record<Region, { x: number; y: number }> = {
  collar: { x: 50, y: 27 }, chest_print: { x: 50, y: 48 }, armpit: { x: 30, y: 41 },
  cuffs: { x: 13, y: 73 }, hem: { x: 50, y: 79 }, seams: { x: 71, y: 58 },
};

interface Props {
  product: Product;
  pins: Pin[];
  axis: Axis | null;
  box: Box | null;
  /** Insufficient evidence: every pin is drawn dashed. */
  thin: boolean;
  activeRegion: Region | null;
  onOpen: (region: Region) => void;
}

/** One button per region. Solid when a stated time has passed; dashed for time-unknown or thin evidence. */
export function DamageMarkers({ product, pins, axis, box, thin, activeRegion, onOpen }: Props) {
  if (!box) return null;
  const map = { ...DEFAULT_REGIONS, ...(product.image.regions ?? {}) };
  return (
    <div className="markers" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      {pins.map((pin) => {
        const pos = map[pin.region];
        const dashed = thin || pin.unknownOnly;
        const all = [...pin.cases, ...pin.otherUnit];
        const n = all.length;
        const types = [...new Set(all.map((c) => c.type))].map((t) => TYPE_LABEL[t]).join(', ');
        const stated = pin.cases.filter((c) => c.t !== null).map((c) => c.t as number);
        const when = dashed
          ? 'time unknown'
          : axis && stated.length ? `from ${formatT(Math.min(...stated), axis)}` : '';
        const label = `${REGION_LABEL[pin.region]}: ${types}, ${n} ${n === 1 ? 'report' : 'reports'}${when ? `, ${when}` : ''}`;
        return (
          <button
            key={pin.region}
            type="button"
            className={`pin ${dashed ? 'pin--dashed' : ''} ${activeRegion === pin.region ? 'pin--active' : ''}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            aria-label={label}
            aria-pressed={activeRegion === pin.region}
            data-region={pin.region}
            onClick={() => onOpen(pin.region)}
          >
            <span className="pin__dot" aria-hidden />
            <span className="pin__tip" role="tooltip" aria-hidden>
              <span className="pin__tip-type">{types}</span>
              <span className="pin__tip-meta mono">{n} {n === 1 ? 'report' : 'reports'}{when ? ` · ${when}` : ''}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
