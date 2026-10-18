import type { Dossier, Frames, Product } from './contract';

export interface DataSource {
  listProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product>;
  /** throws DataError('none' | 'failed') */
  getDossier(id: string): Promise<Dossier>;
  /** may return stages=[photo] only */
  getFrames(id: string): Promise<Frames>;
}
