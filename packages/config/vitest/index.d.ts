import type { UserConfig } from 'vitest/config';

export interface BlokumVitestOptions {
  environment?: 'node' | 'jsdom';
  coverage?: boolean | { include?: string[]; exclude?: string[]; thresholds?: number };
  setupFiles?: string[];
  plugins?: UserConfig['plugins'];
}

export declare function createVitestConfig(options?: BlokumVitestOptions): UserConfig;
declare const config: UserConfig;
export default config;
