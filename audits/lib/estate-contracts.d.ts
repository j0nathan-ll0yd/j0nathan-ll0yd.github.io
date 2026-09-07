// Ambient declarations for @j0nathan-ll0yd/estate-contracts, which ships
// JSDoc-typed .mjs with no .d.ts. `allowJs` does not infer types from
// node_modules JavaScript, so without this file `astro check` fails ts(7016) on
// the import in audits/lib/llms-coherence.ts. Same pattern as
// mantle-LifegamesPortal's test/contracts/estate-contracts.d.mts. Declare ONLY
// the names this repo's typechecked layer imports; test files are outside the
// tsconfig and resolve the package untyped.

declare module '@j0nathan-ll0yd/estate-contracts/llms-assurance' {
  export interface ContractDuration {
    readonly value: number
    readonly unit: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks'
  }

  export const LLM_FRESHNESS_CONFIG: {
    readonly layers: {
      readonly portfolioServing: {
        readonly coherencePolicy: {
          readonly maxCompositionAge: ContractDuration
          readonly maxCompositionSkew: ContractDuration
        readonly maxFutureSkew: ContractDuration
        }
      }
    }
  }

  export function durationToMilliseconds(duration: ContractDuration): number
}
