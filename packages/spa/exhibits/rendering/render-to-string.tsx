import { renderToString } from "@atom.io/spa/server"

import { EmailField } from "../hooks/use-id.tsx"

export function renderEmailField(): string {
	return renderToString(() => <EmailField />, { idPrefix: `signup` })
}
