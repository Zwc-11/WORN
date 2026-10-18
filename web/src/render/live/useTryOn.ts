// React binding: owns the webcam and one engine instance; exposes a snapshot + preview/start/stop/setLook.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DecartTryOn, type DecartTryOnOptions } from './DecartTryOn';
import { MockTryOn, type MockOptions } from './MockTryOn';
import { initialSnapshot, type EngineSnapshot, type Look, type TryOnEngine } from './types';

export interface UseTryOnOptions extends Omit<DecartTryOnOptions, 'log'> {
  engine: 'decart' | 'mock';
  mock?: MockOptions;
  log?: (line: string) => void;
}

const CAMERA_ERRORS: Record<string, string> = {
  NotAllowedError: 'CAMERA_DENIED', // browser or Windows privacy settings blocked it
  SecurityError: 'CAMERA_DENIED', // page not on localhost / https
  NotFoundError: 'NO_CAMERA',
  OverconstrainedError: 'NO_CAMERA',
  NotReadableError: 'CAMERA_BUSY', // another app (Zoom, Teams, OBS, Windows Camera) holds the camera
  AbortError: 'CAMERA_BUSY',
  TypeError: 'CAMERA_INSECURE', // navigator.mediaDevices is undefined on plain-http non-localhost pages
};

export const CAMERA_HELP: Record<string, string> = {
  CAMERA_DENIED: 'Camera blocked. Click the camera icon in the address bar and allow it; on Windows also check Settings > Privacy & security > Camera > "Let desktop apps access your camera".',
  CAMERA_BUSY: 'Another app is using the camera (Zoom, Teams, OBS, the Windows Camera app). Close it and try again.',
  NO_CAMERA: 'No camera found.',
  CAMERA_INSECURE: 'Open the page at http://localhost:5173 (not an IP address): browsers only allow the camera on localhost or https.',
  CAMERA_ERROR: 'The camera could not start.',
};

export function useTryOn(opts: UseTryOnOptions) {
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(initialSnapshot);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const engineRef = useRef<TryOnEngine | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const releaseCamera = useCallback(() => {
    cameraRef.current?.getTracks().forEach((t) => t.stop());
    cameraRef.current = null;
    setCamera(null);
  }, []);

  /** Open the webcam (or reuse it). Publishes a CAMERA_* error snapshot on failure. */
  const acquire = useCallback(async (): Promise<MediaStream | null> => {
    const cur = cameraRef.current;
    if (cur && cur.getVideoTracks().some((t) => t.readyState === 'live')) return cur;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('navigator.mediaDevices is unavailable on this origin'), { name: 'TypeError' });
      const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false });
      const raced = cameraRef.current;
      if (raced && raced.getVideoTracks().some((t) => t.readyState === 'live')) {
        cam.getTracks().forEach((t) => t.stop()); // two opens raced (StrictMode, double click): keep one
        return raced;
      }
      cameraRef.current = cam;
      setCamera(cam);
      return cam;
    } catch (e) {
      const name = (e as { name?: string })?.name ?? '';
      const code = CAMERA_ERRORS[name] ?? 'CAMERA_ERROR';
      optsRef.current.log?.(`camera: ${name} ${(e as Error)?.message ?? ''}`);
      setSnapshot({ ...initialSnapshot(), status: 'error', error: { code, message: (e as Error)?.message ?? name }, detail: code });
      return null;
    }
  }, []);

  const stopEngine = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    engineRef.current?.stop();
    engineRef.current = null;
    setSnapshot(initialSnapshot());
  }, []);

  const stop = useCallback(() => {
    stopEngine();
    releaseCamera();
  }, [stopEngine, releaseCamera]);

  /** Camera only, no engine: lets people frame themselves before Start (and shows camera errors early). */
  const preview = useCallback(async () => (await acquire()) !== null, [acquire]);

  const start = useCallback(
    async (look: Look, preload: string[]): Promise<boolean> => {
      stopEngine(); // keep the camera if the preview already opened it
      const o = optsRef.current;
      const engine: TryOnEngine = o.engine === 'mock' ? new MockTryOn({ mirror: o.mirror !== false, ...o.mock }) : new DecartTryOn(o);
      engineRef.current = engine;
      unsubRef.current = engine.subscribe((s) => {
        setSnapshot(s);
        if (s.status === 'ended' || s.status === 'error') releaseCamera(); // session over: turn the camera off
      });
      setSnapshot({ ...initialSnapshot(), status: 'camera', detail: 'asking for the camera' });
      const cam = await acquire();
      if (engineRef.current !== engine) return false; // a newer start() or stop() took over
      if (!cam) {
        unsubRef.current?.();
        unsubRef.current = null;
        engineRef.current = null;
        return false; // acquire() already published the camera error
      }
      try {
        await engine.start({ camera: cam, look, preload });
        return true;
      } catch {
        releaseCamera(); // the engine already published status 'error' with the reason; free the webcam light
        return false;
      }
    },
    [stopEngine, releaseCamera, acquire],
  );

  const setLook = useCallback((look: Look) => engineRef.current?.setLook(look), []);

  useEffect(() => stop, [stop]);

  return { snapshot, camera, preview, start, stop, setLook };
}
