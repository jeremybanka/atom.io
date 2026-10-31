import { atom } from "atom.io"

export type HeadingDescriptor = {
	id: string
	content: string | null
	level: number
}
export const menuToggleAtom = atom<boolean>({
	key: `menuToggle`,
	default: false,
})

export const pathnameAtom = atom<string>({ key: `pathname`, default: `` })
export const headingsAtom = atom<HeadingDescriptor[]>({
	key: `headings`,
	default: [],
})
export const visibleHeadingIdsAtom = atom<string[]>({
	key: `visibleHeadingIds`,
	default: [],
})
