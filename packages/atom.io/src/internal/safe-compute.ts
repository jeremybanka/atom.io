import { writeToCache } from "./caching.ts"
import { isFn } from "./is-fn.ts"
import type { PureSelector, RegularAtom } from "./state-types.ts"
import type { Store } from "./store/index.ts"

export function safeCompute<T, E>(
	target: Store,
	state: PureSelector<T, E> | RegularAtom<T, E>,
): E | T {
	const { type, key, catch: canCatch } = state
	switch (type) {
		case `readonly_pure_selector`:
		case `writable_pure_selector`: {
			let val: E | T
			target.logger.info(`🧮`, type, key, `computing value`)
			try {
				val = state.getFrom(target)
				if (val instanceof Promise) {
					val = (val as Promise<E & T>).catch((thrown) => {
						target.logger.error(`💥`, type, key, `rejected:`, thrown)
						if (canCatch) {
							for (const Class of canCatch) {
								if (thrown instanceof Class) {
									return thrown
								}
							}
						}
						throw thrown
					}) as E | T
				}
			} catch (e) {
				target.logger.error(`💥`, type, key, `rejected:`, e)
				if (canCatch) {
					for (const Class of canCatch) {
						if (e instanceof Class) {
							return writeToCache(target, state, e)
						}
					}
				}
				throw e
			}
			const cachedValue = writeToCache(target, state, val)
			return cachedValue
		}
		case `atom`: {
			let def: E | T
			if (isFn(state.default)) {
				try {
					def = state.default()
					if (def instanceof Promise) {
						def = (def as Promise<T> & T).catch<E | T>((thrown) => {
							target.logger.error(`💥`, type, key, `rejected:`, thrown)
							if (canCatch) {
								for (const Class of canCatch) {
									if (thrown instanceof Class) {
										return thrown
									}
								}
							}
							throw thrown
						}) as E | T
					}
				} catch (e) {
					target.logger.error(`💥`, type, key, `rejected:`, e)
					if (canCatch) {
						for (const Class of canCatch) {
							if (e instanceof Class) {
								def = writeToCache(target, state, e)
								target.logger.info(
									`✨`,
									state.type,
									key,
									`computed default`,
									def,
								)
								return def
							}
						}
					}
					throw e
				}
			} else {
				def = state.default
				target.logger.info(`✨`, state.type, key, `using static default`, def)
			}
			const cachedValue = writeToCache(target, state, def)
			return cachedValue
		}
	}
}
