/// <reference types="astro/client" />

// The Worker bindings and variables (atlas decision 0160, PR B). The server render reads only
// DATA_PLANE_BASE and SSR_FAULT_INJECTION (src/pages/ssr-dashboard.astro); the repo does not pull
// in @cloudflare/workers-types for one import.
declare module 'cloudflare:workers' {
  export const env: Readonly<Record<string, unknown>>
}
