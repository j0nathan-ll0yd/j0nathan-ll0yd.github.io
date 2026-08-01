/// <reference types="astro/client" />

interface ImportMetaEnv {
  /**
   * Build-time fixture variation selector, wired in astro.config.mjs from the
   * build process env (default 'baseline'). The visual suite sets it to choose
   * a named @j0nathan-ll0yd/fixtures post-adapter variation for the SSR shell.
   */
  readonly FIXTURE_VARIATION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
