import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Frames, Product } from '../../data';
import { stageIndexFor } from '../../render/frameFor';
import { createLiveRenderer, stagePrompt, type LiveRenderer } from './liveRenderer';
import './live-stage.css';

interface Props {
  product: Product;
  frames: Frames | null;
  t: number;
  /** Same meaning as on GarmentStage: false means the stage shows the person only, no wear. */
  drawWear: boolean;
  /** Marker layer; shown only once a photo has been taken, so the marks have a still to sit on. */
  children?: React.ReactNode;
  /** Attached to the taken photo so the parent can place markers on it. */
  imgRef?: RefObject<HTMLImageElement>;
  /** Called with the taken photo's URL (or null when it is gone) so the parent can re-measure. */
  onStill?: (src: string | null) => void;
  /** Back to the still-image stage. Also fired by Escape. */
  onExit: () => void;
}

type Phase =
  | { kind: 'requesting' }
  | { kind: 'denied' }
  | { kind: 'unavailable' }
  | { kind: 'live' }
  | { kind: 'frozen'; still: string };

/**
 * The third GarmentStage implementation (Plan v2 P2): the hoodie on the person in front of the camera.
 * Every state is a designed screen. The model is reached only through `LiveRenderer`.
 */
export function LiveStage({ product, frames, t, drawWear, children, imgRef, onStill, onExit }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'requesting' });
  const rendererRef = useRef<LiveRenderer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const stageIndex = useMemo(() => (frames && drawWear ? stageIndexFor(frames, t) : 0), [frames, drawWear, t]);
  const stageCount = frames?.stages.length ?? 0;

  // Ask for the camera once, start the renderer, mount its output.
  useEffect(() => {
    let cancelled = false;
    const renderer = createLiveRenderer();
    rendererRef.current = renderer;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setPhase({ kind: 'unavailable' }); return; }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : '';
        setPhase({ kind: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable' });
        return;
      }
      if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
      streamRef.current = stream;
      try {
        await renderer.start(stream, product);
      } catch {
        if (!cancelled) setPhase({ kind: 'unavailable' });
        return;
      }
      if (cancelled) return;
      setPhase({ kind: 'live' });
    })();

    return () => {
      cancelled = true;
      renderer.stop();
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      rendererRef.current = null;
      onStill?.(null);
    };
    // One camera session per mounted stage; the product cannot change under a mounted ProductView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Put the renderer's <video> into the stage whenever we are live.
  useEffect(() => {
    const host = mountRef.current;
    const out = rendererRef.current?.output;
    if (phase.kind !== 'live' || !host || !out) return;
    out.className = 'live__video';
    host.appendChild(out);
    return () => { if (out.parentNode === host) host.removeChild(out); };
  }, [phase.kind]);

  // The slider is shared: tell the renderer which stage we are in.
  useEffect(() => {
    if (!frames || (phase.kind !== 'live' && phase.kind !== 'frozen')) return;
    rendererRef.current?.setStage(stageIndex, stagePrompt(frames, stageIndex));
  }, [frames, stageIndex, phase.kind]);

  // Escape leaves the live stage, unless the drawer already used it. Listening on window (after
  // document in the bubble order) is what lets the drawer's preventDefault win regardless of mount order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  // Move focus to the screen's main action as phases change, so keyboard users are never stranded.
  useEffect(() => { primaryRef.current?.focus(); }, [phase.kind]);

  const holdStill = useCallback(() => {
    const video = rendererRef.current?.output;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Mirror the capture so the photo matches what the person saw in the viewfinder.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    const still = canvas.toDataURL('image/jpeg', 0.92);
    setPhase({ kind: 'frozen', still });
    onStill?.(still);
  }, [onStill]);

  const retake = useCallback(() => {
    onStill?.(null);
    setPhase(rendererRef.current?.output ? { kind: 'live' } : { kind: 'unavailable' });
  }, [onStill]);

  const name = `${product.brand} ${product.name}`;

  return (
    <figure className={`stage live live--${phase.kind}`} aria-live="polite">
      <div className="stage__canvas live__canvas">
        {phase.kind === 'requesting' && (
          <div className="live__screen">
            <span className="live__lens" aria-hidden />
            <p className="live__title">Asking for your camera</p>
            <p className="live__hint">Your browser will show a prompt. Nothing is recorded or sent anywhere.</p>
            <button ref={primaryRef} type="button" className="live__btn live__btn--ghost" onClick={onExit}>Back to the photo</button>
          </div>
        )}

        {phase.kind === 'denied' && (
          <div className="live__screen">
            <span className="live__lens live__lens--off" aria-hidden />
            <p className="live__title">No camera, no problem</p>
            <p className="live__hint">You said no to the camera. You can allow it in your browser's site settings and try again, or keep looking at the photo.</p>
            <button ref={primaryRef} type="button" className="live__btn" onClick={onExit}>Back to the photo</button>
          </div>
        )}

        {phase.kind === 'unavailable' && (
          <div className="live__screen">
            <span className="live__lens live__lens--off" aria-hidden />
            <p className="live__title">Try-on isn't available here</p>
            <p className="live__hint">We couldn't reach a camera on this device. The photo view shows the same wear.</p>
            <button ref={primaryRef} type="button" className="live__btn" onClick={onExit}>Back to the photo</button>
          </div>
        )}

        {phase.kind === 'live' && (
          <>
            <div ref={mountRef} className="live__mount" />
            <div className="live__frame" aria-hidden>
              <span className="live__corner live__corner--tl" /><span className="live__corner live__corner--tr" />
              <span className="live__corner live__corner--bl" /><span className="live__corner live__corner--br" />
            </div>
            <p className="live__guide">Step back so the whole top is in frame</p>
            <div className="live__actions">
              <button ref={primaryRef} type="button" className="live__btn" onClick={holdStill}>Hold still</button>
              <button type="button" className="live__btn live__btn--ghost" onClick={onExit}>Back to the photo</button>
            </div>
          </>
        )}

        {phase.kind === 'frozen' && (
          <>
            <img ref={imgRef} className="live__still" src={phase.still} alt={`You, wearing the ${name}`} draggable={false} />
            {children}
            <div className="live__actions">
              <button ref={primaryRef} type="button" className="live__btn live__btn--ghost" onClick={retake}>Retake</button>
              <button type="button" className="live__btn live__btn--ghost" onClick={onExit}>Back to the photo</button>
            </div>
          </>
        )}
      </div>

      <figcaption className="stage__caption mono">
        {phase.kind === 'frozen' ? (
          <>
            <span className="tag">Your photo</span>
            <span>The hoodie's wear is drawn on this photo stage by stage.</span>
            {stageCount > 0 && <span className="live__stage-no">Stage {stageIndex + 1} of {stageCount}</span>}
          </>
        ) : phase.kind === 'live' ? (
          <><span className="tag">Live</span> Drag the slider to age the hoodie on you</>
        ) : (
          <>Try it on</>
        )}
      </figcaption>
    </figure>
  );
}
