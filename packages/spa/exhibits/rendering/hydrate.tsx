import { hydrate, type SpaRoot } from "@atom.io/spa"

import { EmailField } from "../hooks/use-id.tsx"

export function hydrateEmailField(host: Element): SpaRoot {
	return hydrate(() => <EmailField />, host, { idPrefix: `signup` })
}
