import { useEffect, useState, type RefObject } from 'react';

export interface Box { left: number; top: number; width: number; height: number }

/** The rectangle an object-fit: contain image actually occupies inside its element. */
export function useContainedBox(imgRef: RefObject<HTMLImageElement>, src: string): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const measure = () => {
      const { naturalWidth: nw, naturalHeight: nh, clientWidth: cw, clientHeight: ch } = img;
      if (!nw || !nh || !cw || !ch) return;
      const scale = Math.min(cw / nw, ch / nh);
      const width = nw * scale, height = nh * scale;
      setBox({ left: (cw - width) / 2, top: (ch - height) / 2, width, height });
    };
    measure();
    img.addEventListener('load', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(img);
    return () => { img.removeEventListener('load', measure); ro.disconnect(); };
  }, [imgRef, src]);
  return box;
}
