import type { RegularAtomToken, Silo } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import type {
	MosaicDomainIdentity,
	MosaicTextIndexRange,
} from "atom.io/realtime"

import type {
	MosaicTextProjectionClient,
	MosaicTextRangeObserver,
	MosaicTextRangeProjection,
} from "./mosaic-text-projection-client.ts"

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

export type MosaicTextRangeController = Disposable & {
	readonly range: RegularAtomToken<MosaicTextIndexRange>
	readonly view: RegularAtomToken<MosaicTextRangeView>
}

export type MosaicTextRangeControllerOptions<
	Identity extends MosaicDomainIdentity,
	Range extends Json.Serializable = MosaicTextIndexRange,
> = {
	readonly client: MosaicTextProjectionClient<Identity, Range>
	readonly initialRange: MosaicTextIndexRange
	readonly key: string
	readonly overscan?: number
	readonly silo: Pick<Silo, `atom` | `getState` | `setState` | `subscribe`>
}

const sameRange = (
	left: MosaicTextIndexRange,
	right: MosaicTextIndexRange,
): boolean => left.start === right.start && left.end === right.end

/**
 * Store-owned lifecycle for one bounded Mosaic text viewport.
 *
 * The last complete cut stays readable while a replacement range is acquired.
 * React, Solid, and headless consumers can observe the same atoms without
 * rebuilding reconnect and late-release handling in component effects.
 */
export function createMosaicTextRangeController<
	Identity extends MosaicDomainIdentity,
	Range extends Json.Serializable = MosaicTextIndexRange,
>(
	options: MosaicTextRangeControllerOptions<Identity, Range>,
): MosaicTextRangeController {
	const { client, silo } = options
	const rangeAtom = silo.atom<MosaicTextIndexRange>({
		default: options.initialRange,
		// eslint-disable-next-line atom.io/naming-convention -- Controllers need caller-scoped keys so several ranges can coexist in one Store.
		key: `${options.key}:range`,
	})
	const viewAtom = silo.atom<MosaicTextRangeView>({
		default: LOADING,
		// eslint-disable-next-line atom.io/naming-convention -- Controllers need caller-scoped keys so several ranges can coexist in one Store.
		key: `${options.key}:view`,
	})
	let active = true
	let observer: MosaicTextRangeObserver | null = null
	let attempting = false
	let generation = 0
	let attemptedGeneration = -1
	let connectivity = client.residency.state.connectivity
	let observedRange = options.initialRange

	const release = (target: MosaicTextRangeObserver): void => {
		void target.release().catch((error: unknown) => {
			client.residency.store.logger.error(
				`🐞`,
				`transaction`,
				options.key,
				`A Mosaic text range observer could not be released.`,
				error,
			)
		})
	}
	const observe = (): void => {
		if (!active || attempting || observer !== null) return
		if (attemptedGeneration === generation) return
		const attempt = generation
		attemptedGeneration = attempt
		attempting = true
		const requested = silo.getState(rangeAtom)
		silo.setState(viewAtom, (current) =>
			current.status === `ready` ? current : LOADING,
		)
		void client
			.observeRange(
				requested,
				(projection) => {
					if (!active || attempt !== generation) return
					if (
						projection.complete === false ||
						projection.text.length !==
							projection.range.end - projection.range.start
					) {
						return
					}
					silo.setState(viewAtom, {
						error: null,
						projection,
						status: `ready`,
					})
				},
				options.overscan === undefined ? {} : { overscan: options.overscan },
			)
			.then((nextObserver) => {
				if (active && attempt === generation) observer = nextObserver
				else release(nextObserver)
			})
			.catch((error: unknown) => {
				if (!active || attempt !== generation) return
				silo.setState(viewAtom, (current) =>
					current.status === `ready`
						? current
						: ({
								error,
								projection: null,
								status: `error`,
							} satisfies MosaicTextRangeView),
				)
			})
			.finally(() => {
				attempting = false
				if (attemptedGeneration < generation) observe()
			})
	}
	const replaceRange = (next: MosaicTextIndexRange): void => {
		if (sameRange(observedRange, next)) return
		observedRange = next
		generation++
		if (observer !== null) {
			release(observer)
			observer = null
		}
		observe()
	}
	const stopRange = silo.subscribe(rangeAtom, ({ newValue }) => {
		replaceRange(newValue)
	})
	const stopResidency = client.residency.subscribeState((state) => {
		const nextConnectivity = state.connectivity
		if (
			nextConnectivity === `live` &&
			observer === null &&
			(connectivity !== `live` || attemptedGeneration === generation)
		) {
			generation++
			observe()
		}
		connectivity = nextConnectivity
	})
	generation++
	observe()

	return {
		range: rangeAtom,
		view: viewAtom,
		[Symbol.dispose]() {
			if (!active) return
			active = false
			generation++
			stopRange()
			stopResidency()
			if (observer !== null) release(observer)
			observer = null
		},
	}
}
