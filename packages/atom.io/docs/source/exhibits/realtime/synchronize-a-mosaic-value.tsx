import { mutableAtom } from "atom.io"
import { useO } from "atom.io/react"
import { mosaicText } from "atom.io/realtime"
import { useMosaic } from "atom.io/realtime-react"
import type { ReactElement } from "react"

const Markdown = mosaicText({ initialText: `# Shared notes\n` })
const markdownAtom = mutableAtom<InstanceType<typeof Markdown>>({
	class: Markdown,
	key: `markdown`,
})

export function Notes(): ReactElement {
	const document = useO(markdownAtom)
	const collaboration = useMosaic(markdownAtom, {
		actor: `user-42`,
		session: `tab-7`,
	})

	return (
		<textarea
			onChange={(event) => {
				collaboration.change({
					text: event.currentTarget.value,
					type: `replace-text`,
				})
			}}
			readOnly={collaboration.status !== `live`}
			value={document.text}
		/>
	)
}
