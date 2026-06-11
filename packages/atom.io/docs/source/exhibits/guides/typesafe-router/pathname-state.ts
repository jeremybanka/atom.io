import { atom, setState } from "atom.io"

import type { Pathname, PathnameWithSearch } from "./route-shape"

export const pathnameAtom = atom<Pathname | (string & {})>({
	key: "pathname",
	default: () => window.location.pathname,
	effects: [
		({ setSelf }) => {
			document.addEventListener("click", (event) => {
				const anchor = (event.target as HTMLElement).closest("a")
				if (!(anchor instanceof HTMLAnchorElement)) return

				const href = anchor.getAttribute("href")
				if (!href?.startsWith("/")) return

				event.preventDefault()
				history.pushState(null, "", href)
				setSelf(window.location.pathname)
			})

			window.addEventListener("popstate", () => {
				setSelf(window.location.pathname)
			})
		},
	],
})

export function navigate(pathname: Pathname | PathnameWithSearch): void {
	history.pushState(null, "", pathname)
	setState(pathnameAtom, pathname.split("?")[0] as Pathname)
}
