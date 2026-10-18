// WORN data contract — Plan v2, "Modules and the data contract".
// Everything the UI prints comes from these fields; nothing is hard-coded in a component.
import { z } from 'zod';

export const AXES = ['months', 'washes'] as const;
export const DAMAGE_TYPES = ['pilling', 'fading', 'collar_deform', 'cuff_wear', 'seam_split', 'print_crack'] as const;
export const REGIONS = ['collar', 'cuffs', 'armpit', 'hem', 'seams', 'chest_print'] as const;
export const SITES = ['amazon', 'uniqlo', 'urbanoutfitters', 'reddit', 'youtube'] as const;

export type Axis = (typeof AXES)[number];
export type DamageType = (typeof DAMAGE_TYPES)[number];
export type Region = (typeof REGIONS)[number];
export type Site = (typeof SITES)[number];

const axis = z.enum(AXES);
const damageType = z.enum(DAMAGE_TYPES);
const region = z.enum(REGIONS);

/** Percent coordinates (0–100) of a region on the hero image. Optional extension agreed for P0. */
export const RegionPointSchema = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) });

export const ProductSchema = z.object({
  id: z.string().min(1),
  brand: z.string(),
  name: z.string(),
  type: z.literal('hoodie'),
  material: z.string().optional(),
  color: z.string().optional(),
  price: z.object({ amount: z.number().nonnegative(), currency: z.literal('USD') }).optional(),
  url: z.string().url(),
  image: z.object({
    hero: z.string().min(1),
    flat: z.string().optional(),
    /** Optional: where each region sits on the hero image. Falls back to a generic hoodie map. */
    regions: z.record(region, RegionPointSchema).optional(),
  }),
  evidence: z.enum(['live', 'sample', 'none']),
});

export const CaseSchema = z.object({
  id: z.string().min(1),
  type: damageType,
  region,
  /** In dossier.axis units; null = time unknown. Never filled by the UI. */
  t: z.number().nonnegative().nullable(),
  /** Set when the owner used the other unit; such a case stays off the slider. */
  unitStated: axis.optional(),
  /** Verbatim, <= 160 chars. Fixture-authored text starts with "[sample]". */
  quote: z.string().max(160),
  photo: z.object({ url: z.string().min(1), w: z.number().int().positive(), h: z.number().int().positive() }).optional(),
  source: z.object({
    site: z.enum(SITES),
    url: z.string().url(),
    date: z.string().min(1),
    rating: z.number().min(1).max(5).optional(),
  }),
});

const countRecord = <K extends string>(keys: readonly K[]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, z.number().int().nonnegative()])) as Record<K, z.ZodNumber>);

export const DossierSchema = z.object({
  productId: z.string().min(1),
  /** null when no case states a time. */
  axis: axis.nullable(),
  reviewsRead: z.number().int().nonnegative(),
  reviewsWithPhotos: z.number().int().nonnegative(),
  cases: z.array(CaseSchema),
  counts: z.object({ byType: countRecord(DAMAGE_TYPES), byRegion: countRecord(REGIONS) }),
  /** true for fixtures and any hand-made data. */
  sample: z.boolean(),
  updatedAt: z.string().min(1),
});

export const FramesSchema = z.object({
  productId: z.string().min(1),
  axis,
  /** Ascending t; stage 0 is the product photo. */
  stages: z.array(z.object({ t: z.number().nonnegative(), image: z.string().min(1), basedOn: z.array(z.string()) })).min(1),
  generated: z.literal(true),
  label: z.literal('illustration'),
});

export const ProductListSchema = z.array(ProductSchema);

export type Product = z.infer<typeof ProductSchema>;
export type Case = z.infer<typeof CaseSchema>;
export type Dossier = z.infer<typeof DossierSchema>;
export type Frames = z.infer<typeof FramesSchema>;
export type RegionPoint = z.infer<typeof RegionPointSchema>;

/** Thrown by getDossier: 'none' = product has no evidence source; 'failed' = source threw or timed out. */
export class DataError extends Error {
  readonly kind: 'none' | 'failed';
  constructor(kind: 'none' | 'failed', message?: string) {
    super(message ?? kind);
    this.name = 'DataError';
    this.kind = kind;
  }
}

/** Minimum number of cases before wear is drawn (Plan v2, "Insufficient evidence"). */
export const MIN_CASES_FOR_WEAR = 3;
