import { atom, setState } from "atom.io"

import type { Pathname, PathnameWithSearch } from "./route-shape.ts"

export const pathnameAtom = atom<Pathname | (string & {})>({
	key: `pathname`,
	default: () => window.location.pathname,
	effects: [
		({ setSelf }) => {
			const syncFromBrowser = () => {
				setSelf(window.location.pathname)
			}
			const navigateFromClick = (event: MouseEvent) => {
				if (
					event.defaultPrevented ||
					event.button !== 0 ||
					event.metaKey ||
					event.altKey ||
					event.ctrlKey ||
					event.shiftKey
				) {
					return
				}
				if (!(event.target instanceof Element)) return

				const anchor = event.target.closest(`a`)
				if (!(anchor instanceof HTMLAnchorElement)) return
				if (anchor.target && anchor.target !== `_self`) return
				if (anchor.hasAttribute(`download`)) return

				const url = new URL(anchor.href)
				if (url.origin !== window.location.origin) return

				event.preventDefault()
				history.pushState(null, ``, `${url.pathname}${url.search}${url.hash}`)
				setSelf(window.location.pathname)
			}

			document.addEventListener(`click`, navigateFromClick)
			window.addEventListener(`popstate`, syncFromBrowser)

			return () => {
				document.removeEventListener(`click`, navigateFromClick)
				window.removeEventListener(`popstate`, syncFromBrowser)
			}
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
