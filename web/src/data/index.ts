import type { DataSource } from './DataSource';
import { FixtureSource } from './FixtureSource';
import { HttpSource } from './HttpSource';
import { ForcedStateSource, forcedStateFromUrl } from './ForcedStateSource';

/** Picks the source from VITE_SOURCE=fixture|http. The UI imports only this. */
export function createDataSource(): DataSource {
  const kind = import.meta.env.VITE_SOURCE === 'http' ? 'http' : 'fixture';
  const base: DataSource = kind === 'http' ? new HttpSource() : new FixtureSource();
  const forced = forcedStateFromUrl();
  return forced ? new ForcedStateSource(base, forced) : base;
}

export const compareEnabled = import.meta.env.VITE_COMPARE === '1';
/** Shows the "Try it on" button that swaps GarmentStage for LiveStage (P2 slot). */
export const liveEnabled = import.meta.env.VITE_LIVE === '1';

export type { DataSource } from './DataSource';
export * from './contract';
