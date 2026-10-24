// The rate-limiter Worker, human-datastream-rate-limiter (workers/rate-limiter/wrangler.jsonc). It
// exists only to host the ApiRateLimiter Durable Object, which the site Worker reaches through its
// API_RATE_LIMITER binding (`script_name`). It has no route and no workers.dev or Version URL, so no
// request reaches its fetch handler; the handler answers 404 so the Worker carries no behavior of its own.

export { ApiRateLimiter } from './ApiRateLimiter'

export default {
  fetch(): Response {
    return new Response(null, {status: 404})
  }
}
