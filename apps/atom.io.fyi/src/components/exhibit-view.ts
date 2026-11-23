export type ExhibitView = `code` | `ecology` | `preview` | `both`

export const EXHIBIT_VIEW_MESSAGE = `atom-io:exhibit-view`

export function isExhibitView(value: unknown): value is ExhibitView {
	return (
		value === `code` ||
		value === `ecology` ||
		value === `preview` ||
		value === `both`
	)
}
