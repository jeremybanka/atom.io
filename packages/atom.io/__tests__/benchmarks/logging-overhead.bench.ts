import type { LogFn, Logger } from "atom.io"
import { AtomIOLogger } from "atom.io"
import {
	createRegularAtom,
	getFromStore,
	readFromCache,
	type RootStore,
	setIntoStore,
	Store,
	withdraw,
	writeToCache,
} from "atom.io/internal"
import * as v from "vitest"

const nullLog: LogFn = () => {}
const NULL_LOGGER: Logger = {
	error: nullLog,
	info: nullLog,
	warn: nullLog,
}

function prepareCase(name: string, level: `info` | `warn`) {
	const store = new Store({
		name: `logging-overhead:${name}`,
		lifespan: `ephemeral`,
		isProduction: true,
	}) as RootStore
	if (level === `info`) {
		store.loggers = [new AtomIOLogger(`info`, undefined, NULL_LOGGER)]
	}
	const token = createRegularAtom(store, { key: name, default: 0 }, undefined)
	getFromStore(store, token)
	const state = withdraw(store, token)
	let next = 0

	return {
		get: () => {
			getFromStore(store, token)
		},
		readCache: () => {
			readFromCache(store, state, undefined)
		},
		set: () => {
			setIntoStore(store, token, (next ^= 1))
		},
		writeCache: () => {
			writeToCache(store, state, (next ^= 1))
		},
	}
}

const defaultLogging = prepareCase(`default`, `warn`)
const infoLogging = prepareCase(`info`, `info`)
const OPTIONS = { time: 750, warmupTime: 250 } as const

v.describe(`logging overhead`, () => {
	v.bench(`cached getState, default logging`, defaultLogging.get, OPTIONS)
	v.bench(`cached getState, info logging`, infoLogging.get, OPTIONS)
	v.bench(`setState, default logging`, defaultLogging.set, OPTIONS)
	v.bench(`setState, info logging`, infoLogging.set, OPTIONS)
	v.bench(`cache hit, default logging`, defaultLogging.readCache, OPTIONS)
	v.bench(`cache hit, info logging`, infoLogging.readCache, OPTIONS)
	v.bench(`cache write, default logging`, defaultLogging.writeCache, OPTIONS)
	v.bench(`cache write, info logging`, infoLogging.writeCache, OPTIONS)
})
