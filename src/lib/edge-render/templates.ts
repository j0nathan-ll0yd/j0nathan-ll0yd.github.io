// The value-free card templates (atlas decision 0160, PR B, owner decision 2026-10-16, option B).
//
// src/pages/ssr-templates.astro renders every live card in each state that shows no value, from the
// design system's own components, into one prerendered file. The Worker reads that file once per
// isolate and swaps the matching template in for a card of the data-free page. No template carries
// a value, so a swap can never put an export value into the page.
import type {WidgetState} from '@j0nathan-ll0yd/web/runtime/widget-state'
import {TEMPLATE_ATTRIBUTE, TEMPLATES_PAGE_PATH} from './paths'

/** The states a template covers: every state that renders no export value. */
export const TEMPLATE_STATES = Object.freeze(['empty', 'unavailable', 'suppressed'] as const satisfies readonly WidgetState[])

export type TemplateState = (typeof TEMPLATE_STATES)[number]

const TEMPLATE_STATE_SET = new Set<string>(TEMPLATE_STATES)

/** True when the state renders from a value-free template. */
export function isTemplateState(state: WidgetState): state is TemplateState {
  return TEMPLATE_STATE_SET.has(state)
}

/** The card templates, by `<card id>:<state>`. */
export type Templates = ReadonlyMap<string, string>

const TEMPLATE_PATTERN = new RegExp(`<template ${TEMPLATE_ATTRIBUTE}="([A-Za-z]+:[a-z]+)">([\\s\\S]*?)</template>`, 'g')

/** Every template of the templates page. Throws when the page holds none: a build defect. */
export function parseTemplates(html: string): Templates {
  const templates = new Map<string, string>()
  for (const [, key, body] of html.matchAll(TEMPLATE_PATTERN)) {
    if (key !== undefined && body !== undefined) {
      templates.set(key, body.trim())
    }
  }
  if (templates.size === 0) {
    throw new Error(`no ${TEMPLATE_ATTRIBUTE} element in ${TEMPLATES_PAGE_PATH}`)
  }
  return templates
}

/** One card's template, or a thrown error: a missing template is a build defect, never a value leak. */
export function templateFor(templates: Templates, cardId: string, state: TemplateState): string {
  const template = templates.get(`${cardId}:${state}`)
  if (template === undefined) {
    throw new Error(`no template for ${cardId}:${state}`)
  }
  return template
}

let cached: Promise<Templates> | null = null

/**
 * The templates, read once per isolate. A failed read is not cached, so the next render retries;
 * the render that saw it fails, and the Worker answers its 500 page.
 */
export function loadTemplates(read: (path: string) => Promise<Response>): Promise<Templates> {
  if (!cached) {
    cached = read(TEMPLATES_PAGE_PATH).then(async (response) => {
      if (!response.ok) {
        throw new Error(`${TEMPLATES_PAGE_PATH} answered ${response.status}`)
      }
      return parseTemplates(await response.text())
    })
    cached.catch(() => {
      cached = null
    })
  }
  return cached
}

/** Forgets the cached templates. Tests only. */
export function resetTemplatesForTest(): void {
  cached = null
}
