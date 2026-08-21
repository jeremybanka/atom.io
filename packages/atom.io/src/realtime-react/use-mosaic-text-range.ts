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
				.then((nextObserver) => {
					if (active) {
						observer = nextObserver
					} else {
						release(nextObserver)
					}
				})
				.catch((error: unknown) => {
					if (active) setView({ error, projection: null, status: `error` })
				})
				.finally(() => {
					attempting = false
					if (attemptedEpoch < connectivityEpoch) observe()
				})
		}
		const stopResidency = client.residency.subscribeState((state) => {
			const nextConnectivity = state.connectivity
			if (connectivity !== `live` && nextConnectivity === `live`) {
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
