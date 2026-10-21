import type { DotLottie } from '@lottiefiles/dotlottie-web';

/**
 * Lottie animations (B-07) play only through dotlottie-web (CLAUDE.md, TS-25). Its wasm is served by our
 * own site (`apps/web/scripts/copy-vendor.mjs` copies it into `public/vendor`): by default the library would
 * load it from jsdelivr/unpkg, and foreign CDNs are forbidden. The version in the name must match the
 * installed package — the copy script fails the build otherwise.
 */
export const LOTTIE_WASM_URL = '/vendor/dotlottie-player-0.81.0.wasm';

let loader: Promise<typeof DotLottie> | null = null;

/** Loads the player once (in the browser only) and points it to our wasm before the first animation. */
export function loadDotLottie(): Promise<typeof DotLottie> {
  loader ??= import('@lottiefiles/dotlottie-web').then((m) => {
    m.DotLottie.setWasmUrl(LOTTIE_WASM_URL);
    return m.DotLottie;
  });
  return loader;
}
