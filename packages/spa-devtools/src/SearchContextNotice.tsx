/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import css from "./SearchContextNotice.module.css"

export function SearchContextNotice(props: { shown: boolean }): SpaElement {
	return (
		<search-context-notice class={css.class} hidden={!props.shown}>
			Recorded history below is unchanged by search; any selection is retained.
		</search-context-notice>
	)
}
