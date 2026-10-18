// Plan stage -> engine Look. Pure; tested in look.test.ts.
import { VTON_MAX_CHARS } from '../wear/prompts';
import type { TryOnPlan } from '../wear/plan';
import type { Look, ModelChoice, Strategy } from './types';

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * How much text goes with the reference image:
 *   full  -> the planned prompt (garment description + the stage's wear), what Decart's guide recommends
 *   short -> one line naming the garment type; the image carries the rest
 *   image -> no text at all; the model dresses the person from the reference image alone
 */
export type TextMode = 'full' | 'short' | 'image';

/**
 * `fit` (from fitFor) is appended to the garment description. It needs words, so with fit set the
 * image-only mode falls back to the short line plus the fit.
 */
export function lookFor(plan: TryOnPlan, stageIndex: number, model: ModelChoice, strategy: Strategy, text: TextMode = 'full', imageOverride?: string, fit = ''): Look {
  const i = Math.max(0, Math.min(stageIndex, plan.stages.length - 1));
  const s = plan.stages[i];
  const image = imageOverride ?? (strategy === 'reference-swap' ? s.image : plan.stages[0].image);
  const g = plan.garment;
  const short = `Substitute the upper body garment with the ${g.noun} from the reference image${g.styling ? `, ${g.styling}` : ''}${fit ? `, ${fit}` : ''}.`;
  const full = model === 'lucy-2.5' ? s.prompts.lucy : s.prompts.vton;
  const prompt =
    text === 'image'
      ? fit
        ? short
        : ''
      : text === 'short'
        ? short
        : fit
          ? fitted(withFit(full, `${g.description}${g.styling ? `, ${g.styling}` : ''}`, fit), short)
          : full;
  return { key: `t${s.t}-${hash(`${model}|${image}|${prompt}`)}`, prompt, image };
}

/** Images a session may switch to, so they can be uploaded before the first frame. */
export function preloadFor(plan: TryOnPlan, strategy: Strategy): string[] {
  return strategy === 'reference-swap' ? [...new Set(plan.stages.map((s) => s.image))] : [plan.stages[0].image];
}

/** Put the fit right after the garment ("... zipped closed, fitting the person as ..."); append if the anchor is missing. */
function withFit(prompt: string, anchor: string, fit: string): string {
  const i = prompt.indexOf(anchor);
  if (i < 0) return `${prompt.replace(/\.$/, '')}, ${fit}.`;
  const end = i + anchor.length;
  return `${prompt.slice(0, end)}, ${fit}${prompt.slice(end)}`;
}

/** Over the VTON length budget the model starts dropping words; keep the fit and let the reference image carry the garment. */
const fitted = (long: string, short: string) => (long.length <= VTON_MAX_CHARS ? long : short);
