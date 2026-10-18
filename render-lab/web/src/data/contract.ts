// The WORN data contract, copied from "WORN Plan v2" -> Modules and the data contract.
// Owned jointly by A, B and C. Do not change a field here without telling the other two:
// fixtures, the server and every component read these exact shapes.
//
// If the team repo already has web/src/data/contract.ts, keep theirs and delete this copy:
// the render lane only imports the type names below.

import { z } from 'zod';

export type Axis = 'months' | 'washes';
export type DamageType = 'pilling' | 'fading' | 'collar_deform' | 'cuff_wear' | 'seam_split' | 'print_crack';
export type Region = 'collar' | 'cuffs' | 'armpit' | 'hem' | 'seams' | 'chest_print';

export const DAMAGE_TYPES: readonly DamageType[] = ['pilling', 'fading', 'collar_deform', 'cuff_wear', 'seam_split', 'print_crack'];
export const REGIONS: readonly Region[] = ['collar', 'cuffs', 'armpit', 'hem', 'seams', 'chest_print'];

export interface Product {
  id: string; // 'amz-B07XXXX' | 'uniqlo-422990' | 'uo-0123456'
  brand: string;
  name: string;
  type: 'hoodie' | 'quarter_zip'; // C added quarter_zip (Patagonia Better Sweater 1/4-Zip), Oct 17
  material?: string;
  color?: string;
  price?: { amount: number; currency: 'USD' };
  url: string; // product page
  image: { hero: string; flat?: string };
  evidence: 'live' | 'sample' | 'none';
}

export interface Case {
  id: string;
  type: DamageType;
  region: Region;
  t: number | null; // in dossier.axis units; null = time unknown
  unitStated?: Axis; // set when the owner used the other unit
  quote: string; // verbatim, <= 160 chars
  photo?: { url: string; w: number; h: number };
  source: {
    site: 'amazon' | 'uniqlo' | 'urbanoutfitters' | 'reddit' | 'youtube' | 'patagonia' | 'trailspace'; // C added the last two
    url: string;
    date: string;
    rating?: number;
  };
}

export interface Dossier {
  productId: string;
  axis: Axis | null; // null when no case states a time
  reviewsRead: number;
  reviewsWithPhotos: number;
  cases: Case[];
  counts: { byType: Record<DamageType, number>; byRegion: Record<Region, number> };
  sample: boolean; // true for fixtures and any hand-made data
  updatedAt: string;
}

export interface Frames {
  productId: string;
  axis: Axis;
  stages: { t: number; image: string; basedOn: string[] }[]; // ascending t; stage 0 is the product photo
  generated: true;
  label: 'illustration';
}

export interface DataSource {
  listProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product>;
  getDossier(id: string): Promise<Dossier>; // throws DataError('none' | 'failed')
  getFrames(id: string): Promise<Frames>; // may return stages=[photo] only
}

// ---------- zod schemas (validate fixtures at build time and server responses in dev) ----------

const axis = z.enum(['months', 'washes']);
const damageType = z.enum(['pilling', 'fading', 'collar_deform', 'cuff_wear', 'seam_split', 'print_crack']);
const region = z.enum(['collar', 'cuffs', 'armpit', 'hem', 'seams', 'chest_print']);
const httpUrl = z.string().refine((s) => /^https?:\/\//.test(s) || s.startsWith('/'), 'must be an http(s) URL or a root-relative path');

export const ProductSchema = z.object({
  id: z.string().min(1),
  brand: z.string(),
  name: z.string(),
  type: z.enum(['hoodie', 'quarter_zip']),
  material: z.string().optional(),
  color: z.string().optional(),
  price: z.object({ amount: z.number().nonnegative(), currency: z.literal('USD') }).optional(),
  url: httpUrl,
  image: z.object({ hero: httpUrl, flat: httpUrl.optional() }),
  evidence: z.enum(['live', 'sample', 'none']),
});

export const CaseSchema = z.object({
  id: z.string().min(1),
  type: damageType,
  region,
  t: z.number().nonnegative().nullable(),
  unitStated: axis.optional(),
  quote: z.string().min(1).max(160),
  photo: z.object({ url: httpUrl, w: z.number().positive(), h: z.number().positive() }).optional(),
  source: z.object({
    site: z.enum(['amazon', 'uniqlo', 'urbanoutfitters', 'reddit', 'youtube', 'patagonia', 'trailspace']),
    url: httpUrl,
    date: z.string(),
    rating: z.number().min(1).max(5).optional(),
  }),
});

const countsOf = <K extends string>(keys: readonly [K, ...K[]]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, z.number().int().nonnegative()])) as Record<K, z.ZodNumber>);

export const DossierSchema = z
  .object({
    productId: z.string().min(1),
    axis: axis.nullable(),
    reviewsRead: z.number().int().nonnegative(),
    reviewsWithPhotos: z.number().int().nonnegative(),
    cases: z.array(CaseSchema),
    counts: z.object({
      byType: countsOf(['pilling', 'fading', 'collar_deform', 'cuff_wear', 'seam_split', 'print_crack']),
      byRegion: countsOf(['collar', 'cuffs', 'armpit', 'hem', 'seams', 'chest_print']),
    }),
    sample: z.boolean(),
    updatedAt: z.string(),
  })
  .superRefine((d, ctx) => {
    // counts must equal the case list: there is no other source for a number on screen
    for (const k of DAMAGE_TYPES) {
      const n = d.cases.filter((c) => c.type === k).length;
      if (d.counts.byType[k] !== n) ctx.addIssue({ code: 'custom', message: `counts.byType.${k}=${d.counts.byType[k]} but ${n} cases` });
    }
    for (const k of REGIONS) {
      const n = d.cases.filter((c) => c.region === k).length;
      if (d.counts.byRegion[k] !== n) ctx.addIssue({ code: 'custom', message: `counts.byRegion.${k}=${d.counts.byRegion[k]} but ${n} cases` });
    }
    if (d.sample === false && d.cases.some((c) => c.quote.startsWith('[sample]')))
      ctx.addIssue({ code: 'custom', message: 'a [sample] quote in a dossier marked sample: false' });
  });

export const FramesSchema = z
  .object({
    productId: z.string().min(1),
    axis,
    stages: z.array(z.object({ t: z.number().nonnegative(), image: httpUrl, basedOn: z.array(z.string()) })).min(1),
    generated: z.literal(true),
    label: z.literal('illustration'),
  })
  .superRefine((f, ctx) => {
    for (let i = 1; i < f.stages.length; i++)
      if (f.stages[i].t <= f.stages[i - 1].t) ctx.addIssue({ code: 'custom', message: 'stages must be ascending in t' });
    if (f.stages[0].t !== 0) ctx.addIssue({ code: 'custom', message: 'stage 0 must be t = 0 (the product photo)' });
  });
