import type { SpaElement } from "@atom.io/spa"
import { onCommit, useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

export const captionAtom = atom<string>({ key: `caption`, default: `Hello` })
export const captionHeightAtom = atom<number>({
	key: `captionHeight`,
	default: 0,
})

export function Caption(): SpaElement {
	const getCaption = useGetter(captionAtom)
	const setCaptionHeight = useSetter(captionHeightAtom)
	let caption: HTMLParagraphElement | null = null

	onCommit(getCaption, () => {
		setCaptionHeight(caption!.getBoundingClientRect().height)
	})

	return (
		<p
			ref={(element) => {
				caption = element
			}}
		>
			{getCaption()}
		</p>
	)
}
