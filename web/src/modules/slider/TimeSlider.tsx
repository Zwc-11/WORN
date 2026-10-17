import { useId, useRef } from 'react';
import type { Axis, Dossier, Frames } from '../../data';
import { formatT } from '../product/format';
import './time-slider.css';

export interface SliderRange { max: number; ticks: number[] }

/** Ticks at stage values; max covers the latest stage and the latest stated case. */
export function sliderRangeFor(dossier: Dossier, frames: Frames): SliderRange {
  const stageTs = frames.stages.map((s) => s.t);
  const caseTs = dossier.cases.flatMap((c) => (c.t !== null && !c.unitStated ? [c.t] : []));
  const ticks = stageTs.length > 1 ? stageTs : [...new Set([0, ...caseTs])].sort((a, b) => a - b).slice(0, 8);
  const max = Math.max(1, ...stageTs, ...caseTs);
  return { max, ticks };
}

interface Props {
  axis: Axis | null;
  range: SliderRange;
  value: number;
  onChange: (t: number) => void;
  disabled?: boolean;
}

export function TimeSlider({ axis, range, value, onChange, disabled }: Props) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const label = axis ?? 'time';
  const ticks = range.ticks;

  const snap = () => {
    if (!ticks.length) return;
    const nearest = ticks.reduce((best, t) => (Math.abs(t - value) < Math.abs(best - value) ? t : best), ticks[0]);
    if (nearest !== value) onChange(nearest);
  };

  // Arrow keys move one tick (stage), Home/End jump to the ends.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!ticks.length) return;
    const i = ticks.findIndex((t) => t >= value - 1e-6);
    const idx = i === -1 ? ticks.length - 1 : i;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = ticks[Math.min(ticks.length - 1, value >= ticks[idx] - 1e-6 ? idx + 1 : idx)];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = ticks[Math.max(0, value > ticks[idx] + 1e-6 ? idx : idx - 1)];
    else if (e.key === 'Home') next = ticks[0];
    else if (e.key === 'End') next = ticks[ticks.length - 1];
    if (next !== null) { e.preventDefault(); onChange(next); }
  };

  const pct = (t: number) => `${(t / range.max) * 100}%`;

  return (
    <div className={`slider ${disabled ? 'slider--disabled' : ''}`} style={{ '--pos': pct(value) } as React.CSSProperties}>
      <label htmlFor={id} className="slider__axis mono">{label}</label>
      <div className="slider__track">
        <input
          ref={ref}
          id={id}
          className="slider__input"
          type="range"
          min={0}
          max={range.max}
          step={0.1}
          value={value}
          disabled={disabled}
          aria-valuetext={axis ? formatT(value, axis) : 'time unknown'}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={snap}
          onKeyDown={onKeyDown}
        />
        <div className="slider__ticks" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className={`slider__tick ${t <= value + 1e-6 ? 'slider__tick--passed' : ''}`} style={{ left: pct(t) }}>
              <i /><b className="mono">{t}</b>
            </span>
          ))}
        </div>
      </div>
      <output htmlFor={id} className="slider__value mono" aria-live="off">{axis ? formatT(value, axis) : '—'}</output>
    </div>
  );
}
