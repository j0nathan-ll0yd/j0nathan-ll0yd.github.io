// Section delimiters and field labels are presentational scaffolding for the
// humanstxt.org format — they live here, not in the copy package. All
// customer-facing string values (name, title, location, URLs, stack, etc.)
// are sourced from @lifegames/copy to honour the zero-duplication invariant.
import identity from '@lifegames/copy/identity.flat.json'

export const prerender = true

export function GET(): Response {
  const lastUpdate = new Date().toISOString().slice(0, 10)

  const body = `/* TEAM */
Name: ${identity.person.name}
Role: ${identity.person.jobTitle}
From: ${identity.person.location}
Contact: ${identity.person.sameAs[0]}

/* THANKS */
${identity.humansTxt.thanks.map((credit: string) => `Name: ${credit}`).join('\n')}

/* SITE */
Last update: ${lastUpdate}
Software: ${identity.humansTxt.stack.join(', ')}
Hosting: ${identity.humansTxt.hosting}
Standards: ${identity.humansTxt.standards}
`.trimStart()

  return new Response(body, {headers: {'Content-Type': 'text/plain; charset=utf-8'}})
}
