// One request's data-plane read and render clock (atlas decision 0160, PR B). The test seams apply
// here and only here: the fixture data plane (DATA_PLANE_BASE), the Step 6.10 fault and the fixed
// render clock, each only on a preview or loopback host (./config.ts, ./faults.ts).
import {DATA_PLANE_BASE_VAR, requestDataPlaneBase} from './config'
import {faultableHost, faultyFetch, requestClock, requestFault, SSR_FAULT_VAR} from './faults'
import {type DashboardLoad, loadDashboard} from './loader'

/** The Worker variables the server render reads. */
export type RenderVars = Readonly<Record<string, unknown>>

export function loadForRequest(request: Request, vars: RenderVars): Promise<DashboardLoad> {
  // A fixture data plane only on a preview or loopback host; production always reads CloudFront.
  const base = requestDataPlaneBase(request, vars[DATA_PLANE_BASE_VAR], faultableHost)
  const fault = requestFault(request, vars[SSR_FAULT_VAR])
  return loadDashboard({base, ...(fault ? {fetch: faultyFetch(fault)} : {})})
}

/** Date.now(), or the fixed clock the visual suite sends (X-SSR-Clock). */
export function renderClock(request: Request, vars: RenderVars): number {
  return requestClock(request, vars[SSR_FAULT_VAR]) ?? Date.now()
}
