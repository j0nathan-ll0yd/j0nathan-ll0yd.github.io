import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { fileURLToPath } from 'node:url';
import { identitySchema } from '@lifegames/copy/identity.zod';

const identityPath = fileURLToPath(import.meta.resolve('@lifegames/copy/identity.flat.json'));

const copy = defineCollection({
  // file() does not natively handle a single flat object, so wrap it under one
  // entry id. Returning an object map ({ identity: data }) — rather than an
  // array with an injected `id` field — keeps the entry data clean: Astro uses
  // the key as the entry id and validates the untouched value, which the
  // generated `.strict()` identitySchema requires (an injected `id` key would
  // be rejected as an unrecognized property).
  loader: file(identityPath, { parser: (text) => ({ identity: JSON.parse(text) }) }),
  schema: identitySchema,
});

export const collections = { copy };
