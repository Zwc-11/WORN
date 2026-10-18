import type { Axis, DamageType, Product, Region } from '../../data';

export const formatPrice = (p: NonNullable<Product['price']>) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency, maximumFractionDigits: p.amount % 1 ? 2 : 0 }).format(p.amount);

export const TYPE_LABEL: Record<DamageType, string> = {
  pilling: 'pilling', fading: 'fading', collar_deform: 'collar deformation',
  cuff_wear: 'cuff wear', seam_split: 'seam split', print_crack: 'print cracking',
};
export const REGION_LABEL: Record<Region, string> = {
  collar: 'collar', cuffs: 'cuffs', armpit: 'armpit', hem: 'hem', seams: 'seams', chest_print: 'chest print',
};
export const SITE_LABEL: Record<string, string> = {
  amazon: 'Amazon', uniqlo: 'Uniqlo', urbanoutfitters: 'Urban Outfitters', reddit: 'Reddit', youtube: 'YouTube',
};

/** "8 months" / "1 wash" / "25 washes" — never mixes units. */
export function formatT(t: number, axis: Axis): string {
  const n = Math.round(t);
  if (axis === 'washes') return `${n} ${n === 1 ? 'wash' : 'washes'}`;
  return `${n} ${n === 1 ? 'month' : 'months'}`;
}

export const formatCount = (n: number) => new Intl.NumberFormat('en-US').format(n);

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
