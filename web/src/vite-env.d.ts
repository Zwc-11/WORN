/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SOURCE?: 'fixture' | 'http';
  readonly VITE_API_BASE?: string;
  readonly VITE_COMPARE?: string;
}
