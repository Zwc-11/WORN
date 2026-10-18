// Live implementation of the garment stage (Plan v2: "Live try-on, if it lands, is a third
// implementation of GarmentStage, not a change to the contract").
//
// Same inputs as A's GarmentStage (product, dossier, frames, slider t) plus `fallback`, which is
// A's stills stage. The fallback is on screen until the live picture arrives and whenever live
// fails, so the demo can never show a black box. No model, API or engine names reach the page.
//
//   <LiveGarmentStage product={p} dossier={d} frames={f} t={t} fallback={<GarmentStage ... />} />

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Dossier, Frames, Product } from '../../data/contract';
import { stageIndexFor } from '../../render/wear/composeWear';
import { planTryOn } from '../../render/wear/plan';
import type { GarmentOverride } from '../../render/wear/prompts';
import { lookFor, preloadFor } from '../../render/live/look';
import { fitFor, type Size } from '../../render/wear/fit';
import type { EngineSnapshot, ModelChoice, Strategy } from '../../render/live/types';
import { useTryOn } from '../../render/live/useTryOn';
import type { MockOptions } from '../../render/live/MockTryOn';
import './live-stage.css';

export interface LiveGarmentStageProps {
  product: Product;
  dossier: Dossier | null;
  frames: Frames | null;
  /** Slider value on dossier.axis. */
  t: number;
  /** Stills stage shown before live starts and whenever live fails. */
  fallback: ReactNode;
  engine?: 'decart' | 'mock';
  model?: ModelChoice;
  strategy?: Strategy;
  /** Garment text override (fixtures/tryon.json[product.id], tuned in the lab). */
  garment?: GarmentOverride;
  /** Size the person normally wears and the size being tried; omitted = no fit text. */
  size?: { wears: Size; tries: Size };
  mirror?: boolean;
  selfAnchor?: boolean;
  autoStart?: boolean;
  mock?: MockOptions;
  onSnapshot?: (s: EngineSnapshot) => void;
  className?: string;
}

const WORKING = new Set(['camera', 'preparing', 'connecting']);
const PROBLEM: Record<string, string> = {
  CAMERA_DENIED: 'Camera access was blocked.',
  NO_CAMERA: 'No camera found.',
  CAMERA_BUSY: 'The camera is in use by another app.',
};

export function LiveGarmentStage(props: LiveGarmentStageProps) {
  const { product, dossier, frames, t, fallback, engine = 'decart', model = 'lucy-vton-latest', strategy = 'reference-swap' } = props;
  const plan = useMemo(() => planTryOn(product, dossier, frames, { garment: props.garment }), [product, dossier, frames, props.garment]);
  const stageIndex = stageIndexFor(plan.stages, t);
  const fit = props.size ? fitFor(props.size.wears, props.size.tries).phrase : '';
  const look = useMemo(() => lookFor(plan, stageIndex, model, strategy, 'full', undefined, fit), [plan, stageIndex, model, strategy, fit]);
  const stage = plan.stages[stageIndex];

  const { snapshot, start, stop, setLook } = useTryOn({ engine, model, mirror: props.mirror, selfAnchor: props.selfAnchor, mock: props.mock });
  const videoRef = useRef<HTMLVideoElement>(null);
  const live = (snapshot.status === 'live' || snapshot.status === 'reconnecting') && snapshot.stream !== null;

  useEffect(() => {
    props.onSnapshot?.(snapshot);
  }, [snapshot, props.onSnapshot]);

  // follow the slider: the scheduler collapses a drag into the last stage reached
  useEffect(() => {
    if (snapshot.status === 'live') setLook(look);
  }, [look, snapshot.status, setLook]);

  useEffect(() => {
    const v = videoRef.current;
    if (v && v.srcObject !== snapshot.stream) v.srcObject = snapshot.stream;
  }, [snapshot.stream, live]);

  const begin = () => void start(look, preloadFor(plan, strategy));

  useEffect(() => {
    if (props.autoStart) begin();
    return stop;
    // start once per product/engine/model/strategy; slider moves go through setLook
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autoStart, product.id, engine, model, strategy]);

  const caption =
    plan.evidence === 'none'
      ? 'No owner reports for this item yet'
      : plan.evidence === 'thin'
        ? `Only ${dossier?.cases.length ?? 0} reports, shown as-is`
        : stage.basedOn.length > 0
          ? `Illustration composed from ${stage.basedOn.length} owner report${stage.basedOn.length === 1 ? '' : 's'}`
          : 'As sold';

  const failed = snapshot.status === 'error' || snapshot.status === 'ended';

  return (
    <div className={`live-stage ${props.className ?? ''}`} data-status={snapshot.status} data-stage={stage.t}>
      <div className="live-stage__layer" aria-hidden={live}>
        {fallback}
      </div>
      <video ref={videoRef} className={`live-stage__video ${live ? 'is-on' : ''}`} autoPlay playsInline muted />

      {live && (
        <div className="live-stage__chip" role="status">
          <span className={`live-stage__dot ${snapshot.status === 'reconnecting' ? 'is-warn' : ''}`} />
          {snapshot.status === 'reconnecting' ? 'Reconnecting' : 'Live try-on'}
        </div>
      )}
      {live && snapshot.pendingKey && <div className="live-stage__progress" aria-hidden />}

      {WORKING.has(snapshot.status) && (
        <div className="live-stage__notice" role="status">
          <div className="live-stage__progress" />
          {snapshot.status === 'camera' ? 'Starting the camera' : snapshot.queuePosition ? `Waiting for a slot (${snapshot.queuePosition})` : 'Putting it on you'}
        </div>
      )}

      {snapshot.status === 'idle' && !props.autoStart && (
        <button className="live-stage__start" onClick={begin}>
          Try it on
        </button>
      )}

      {failed && (
        <div className="live-stage__notice is-quiet" role="status">
          {PROBLEM[snapshot.error?.code ?? ''] ?? 'Live view unavailable. Showing the stills.'}
          <button onClick={begin}>Retry</button>
        </div>
      )}

      <div className="live-stage__caption">{caption}</div>
    </div>
  );
}
