import type { MosaicTextIndexRange } from "atom.io/realtime"
import type {
	MosaicTextProjectionClient,
	MosaicTextRangeObserver,
	MosaicTextRangeProjection,
} from "atom.io/realtime-client"
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
		setView(LOADING)
	}, [client])
	useEffect(() => {
		let active = true
		let observer: MosaicTextRangeObserver | null = null
		let attempting = false
		let connectivityEpoch = 0
		let attemptedEpoch = -1
		let connectivity = client.residency.state.connectivity
		const release = (target: MosaicTextRangeObserver): void => {
			void target.release().catch((error: unknown) => {
				client.residency.store.logger.error(
					`🐞`,
					`transaction`,
					`mosaic-text-projection`,
					`A Mosaic text projection observer could not be released.`,
					error,
				)
			})
		}
		const observe = (): void => {
			if (!active || attempting || observer !== null) return
			if (attemptedEpoch === connectivityEpoch) return
			attemptedEpoch = connectivityEpoch
			attempting = true
			// A range change (for example after an edit changes document length)
			// must not unmount an already-rendered viewport while its replacement
			// observer is acquired. Preserve that projection until the next one is
			// ready; changing clients resets it in the effect above.
			setView((current) => (current.status === `ready` ? current : LOADING))
			void client
				.observeRange(
					{ end, kind: `utf16-range`, start },
					(projection) => {
						if (!active) return
						// A subscription can learn the new logical range before its
						// resident leaves settle. Do not expose that shorter intermediate
						// value to renderers as an authoritative projection.
						if (
							projection.text.length !==
							projection.range.end - projection.range.start
						) {
							return
						}
						setView({ error: null, projection, status: `ready` })
					},
					overscan === undefined ? {} : { overscan },
				)
				.then((nextObserver) => {
					if (active) {
						observer = nextObserver
					} else {
						release(nextObserver)
					}
				})
				.catch((error: unknown) => {
					if (active) {
						setView((current) =>
							current.status === `ready`
								? current
								: { error, projection: null, status: `error` },
						)
					}
				})
				.finally(() => {
					attempting = false
					if (attemptedEpoch < connectivityEpoch) observe()
				})
		}
		const stopResidency = client.residency.subscribeState((state) => {
			const nextConnectivity = state.connectivity
			if (
				nextConnectivity === `live` &&
				observer === null &&
				(connectivity !== `live` || attemptedEpoch === connectivityEpoch)
			) {
				connectivityEpoch++
				observe()
			}
			connectivity = nextConnectivity
		})
		connectivityEpoch++
		observe()
		return () => {
			active = false
			stopResidency()
			if (observer !== null) release(observer)
		}
	}, [client, end, overscan, start])
	return view
}
