import {experimental_AstroContainer as AstroContainer} from 'astro/container'
import {expect, it} from 'vitest'
import HeartRate from '@j0nathan-ll0yd/web/production/HeartRate.astro'
it('renders', async () => {
  const c = await AstroContainer.create()
  const html = await c.renderToString(HeartRate, {props: {state: 'unavailable'}})
  expect(html).toContain('cardHR')
  console.error('LEN', html.length, html.slice(0, 300))
})
