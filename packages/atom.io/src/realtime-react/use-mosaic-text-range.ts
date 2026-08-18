import type {
	MosaicTextProjectionClient,
	MosaicTextRangeProjection,
} from "atom.io/realtime-client"
import type { MosaicTextIndexRange } from "atom.io/realtime"
import { useEffect, useState } from "react"

export type MosaicTextRangeView =
	| {
			readonly error: null
			readonly projection: null
			readonly status: `loading`
	  }
	| {
			readonly error: null
			readonly projection: MosaicTextRangeProjection
			readonly status: `ready`
	  }
	| {
			readonly error: unknown
			readonly projection: null
			readonly status: `error`
	  }

const LOADING: MosaicTextRangeView = Object.freeze({
	error: null,
	projection: null,
	status: `loading`,
})

/** React owns viewport lifecycle; the Store-owned projection client owns state. */
export function useMosaicTextRange(
	client: MosaicTextProjectionClient,
	range: MosaicTextIndexRange,
	options: { readonly overscan?: number } = {},
): MosaicTextRangeView {
	const [view, setView] = useState<MosaicTextRangeView>(LOADING)
	const start = range.start
	const end = range.end
	const overscan = options.overscan
	useEffect(() => {
		let active = true
		let release: (() => Promise<void>) | null = null
		setView(LOADING)
		void client
			.observeRange(
				{ end, kind: `utf16-range`, start },
				(projection) => {
					if (!active) return
					setView({ error: null, projection, status: `ready` })
				},
				overscan === undefined ? {} : { overscan },
			)
			.then((observer) => {
				if (active) {
					release = () => observer.release()
				} else {
					void observer.release()
				}
			})
			.catch((error: unknown) => {
				if (active) setView({ error, projection: null, status: `error` })
			})
		return () => {
			active = false
			void release?.()
		}
	}, [client, end, overscan, start])
	return view
}
