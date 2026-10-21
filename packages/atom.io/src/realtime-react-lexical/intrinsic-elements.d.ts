/* eslint-disable quotes -- TypeScript module names and hyphenated JSX tags require string literals. */
import type { DetailedHTMLProps, HTMLAttributes } from "react"

type CustomElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>

declare module "react" {
	namespace JSX {
		interface IntrinsicElements {
			"collaborator-caret": CustomElement
			"collaborator-label": CustomElement
			"collaborator-overlays": CustomElement
			"collaborator-presence": CustomElement
			"collaborator-selection": CustomElement
			"editor-placeholder": CustomElement
			"lexical-editor": CustomElement
			"mosaic-lexical-text-editor": CustomElement
		}
	}
}
