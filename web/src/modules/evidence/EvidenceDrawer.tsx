import { useEffect, useRef } from 'react';
import type { Axis, Case, Dossier, Region } from '../../data';
import type { Pin } from '../../render/pinsFor';
import { REGION_LABEL, SITE_LABEL, TYPE_LABEL, formatCount, formatDate, formatT } from '../product/format';
import './evidence-drawer.css';

interface Props {
  pin: Pin | null;
  dossier: Dossier;
  axis: Axis | null;
  thin: boolean;
  onClose: () => void;
  /** Element to return focus to on close (the pin that opened the drawer). */
  returnFocusTo: HTMLElement | null;
}

/** Slides over the right column. Traps focus, closes on Escape, returns focus to the opening pin. */
export function EvidenceDrawer({ pin, dossier, axis, thin, onClose, returnFocusTo }: Props) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = !!pin;

  useEffect(() => {
    if (!open) return;
    const el = ref.current!;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const focusables = el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnFocusTo?.focus();
    };
  }, [open, onClose, returnFocusTo]);

  if (!pin) return null;
  const all: Case[] = [...pin.cases, ...pin.otherUnit];
  const n = all.length;
  const photos = all.filter((c) => c.photo).length;
  const region = REGION_LABEL[pin.region as Region];

  return (
    <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <header className="drawer__head">
        <div>
          <p className="drawer__kicker mono">{region}</p>
          <h2 id="drawer-title" className="drawer__title">
            {thin ? `Only ${n} ${n === 1 ? 'report' : 'reports'}, shown as-is` : `${n} owner ${n === 1 ? 'report' : 'reports'}`}
          </h2>
          <p className="drawer__sub mono">
            of {formatCount(dossier.reviewsRead)} reviews read{photos ? ` · ${photos} with ${photos === 1 ? 'a photo' : 'photos'}` : ''}
          </p>
        </div>
        <button ref={closeRef} type="button" className="drawer__close" onClick={onClose} aria-label="Close evidence">×</button>
      </header>
      <ol className="drawer__list">
        {all.map((c) => (
          <li key={c.id} className="case">
            <div className="case__top">
              <span className="case__type">{TYPE_LABEL[c.type]}</span>
              <span className={`case__when mono ${c.t === null ? 'case__when--unknown' : ''}`}>
                {c.unitStated && c.unitStated !== axis
                  ? `stated in ${c.unitStated}, not on the slider`
                  : c.t !== null && axis ? formatT(c.t, axis) : 'time unknown'}
              </span>
              {dossier.sample && <span className="tag tag--sample">Sample data</span>}
            </div>
            {c.photo && <Photo photo={c.photo} alt={`Owner photo: ${TYPE_LABEL[c.type]} at the ${region}`} />}
            <blockquote className="case__quote">{c.quote}</blockquote>
            <p className="case__source mono">
              {SITE_LABEL[c.source.site] ?? c.source.site} · {formatDate(c.source.date)}
              {c.source.rating !== undefined && <> · {c.source.rating}/5</>}
              {' · '}
              <a href={c.source.url} target="_blank" rel="noopener noreferrer">Open source ↗</a>
            </p>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function Photo({ photo, alt }: { photo: NonNullable<Case['photo']>; alt: string }) {
  const ref = useRef<HTMLImageElement>(null);
  return (
    <div className="case__photo" style={{ aspectRatio: `${photo.w} / ${photo.h}` }}>
      <img ref={ref} src={photo.url} alt={alt} loading="lazy" onLoad={(e) => e.currentTarget.classList.add('is-loaded')} />
    </div>
  );
}
