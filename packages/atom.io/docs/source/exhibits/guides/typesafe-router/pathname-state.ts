import { atom, setState } from "atom.io"

import type { Pathname, PathnameWithSearch } from "./route-shape.ts"

export const pathnameAtom = atom<Pathname | (string & {})>({
	key: `pathname`,
	default: () => window.location.pathname,
	effects: [
		({ setSelf }) => {
			// DOCS REVIEW: This global click interception is likely to be copied.
			// Should the docs mention modifier keys, `target`, downloads, and
			// cleanup so new-tab/browser-native link behavior is preserved?
			document.addEventListener(`click`, (event) => {
				const anchor = (event.target as HTMLElement).closest(`a`)
				if (!(anchor instanceof HTMLAnchorElement)) return

				const href = anchor.getAttribute(`href`)
				if (!href?.startsWith(`/`)) return

				event.preventDefault()
				history.pushState(null, ``, href)
				setSelf(window.location.pathname)
			})

			window.addEventListener(`popstate`, () => {
				setSelf(window.location.pathname)
			})
		},
	],
})

// DOCS REVIEW: The atom type allows unknown strings for pasted/invalid paths,
// but the guide only briefly hints at that. Should it explain this `(string & {})`
// escape hatch near the route-validation step?
export function navigate(pathname: Pathname | PathnameWithSearch): void {
	history.pushState(null, ``, pathname)
	setState(pathnameAtom, pathname.split(`?`)[0] as Pathname)
}
