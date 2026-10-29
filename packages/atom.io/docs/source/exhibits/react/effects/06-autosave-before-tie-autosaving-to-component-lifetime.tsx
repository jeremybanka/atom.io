import { useEffect, useMemo, useState } from "react"

import { createAutosaver } from "./helpers.ts"
import { DraftForm } from "./views.tsx"

export function DraftEditor({ draftId }: { draftId: string }) {
	const [text, setText] = useState<string | null>(null)
	const [status, setStatus] = useState(`Ready`)
	const autosave = useMemo(() => createAutosaver(draftId, setStatus), [draftId])
	useEffect(() => {
		if (text !== null) autosave.schedule(text)
		return autosave.cancel
	}, [autosave, text])
	return <DraftForm text={text ?? ``} onChange={setText} status={status} />
}
