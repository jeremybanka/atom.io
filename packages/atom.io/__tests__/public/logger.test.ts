import type { Logger } from "atom.io"
import {
	atom,
	AtomIOLogger,
	getState,
	simpleLog,
	simpleLogger,
	timeline,
	undo,
} from "atom.io"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"

import { createNullLogger } from "../__util__/index.ts"

let internalLogger: AtomIOLogger
let implicitStore: NonNullable<typeof globalThis.ATOM_IO_IMPLICIT_STORE>
const externalLogger: Logger = createNullLogger()
const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	const store = globalThis.ATOM_IO_IMPLICIT_STORE
	if (store === undefined) {
		throw new Error(`Expected the implicit store to exist.`)
	}
	implicitStore = store
	implicitStore.config.isProduction = true
	setTestLogLevel(null)
	implicitStore.loggers[1] = internalLogger = new AtomIOLogger(
		`info`,
		undefined,
		externalLogger,
	)
	vitest.spyOn(internalLogger, `error`).mockReset()
	vitest.spyOn(internalLogger, `warn`).mockReset()
	vitest.spyOn(internalLogger, `info`).mockReset()
	vitest.spyOn(externalLogger, `error`).mockReset()
	vitest.spyOn(externalLogger, `warn`).mockReset()
	vitest.spyOn(externalLogger, `info`).mockReset()
})

describe(`setLogLevel`, () => {
	it(`allows logging at the preferred level`, () => {
		implicitStore.loggers[1].logLevel = null
		atom<number>({
			key: `count`,
			default: 0,
		})
		expect(externalLogger.info).not.toHaveBeenCalled()
		implicitStore.loggers[1].logLevel = `info`
		const countAtom = atom<number>({
			key: `count`,
			default: 0,
		})
		expect(externalLogger.error).toHaveBeenCalled()
		implicitStore.loggers[1].logLevel = `error`
		const countTimeline = timeline({
			key: `count`,
			scope: [countAtom],
		})
		undo(countTimeline)
		expect(externalLogger.warn).not.toHaveBeenCalled()
		implicitStore.loggers[1].logLevel = `warn`
		undo(countTimeline)
		expect(externalLogger.warn).toHaveBeenCalled()
	})
	it(`filters out messages based on a predicate`, () => {
		internalLogger.filter = (icon) => icon === `📖`
		const countAtom = atom<number>({
			key: `count`,
			default: 0,
		})
		expect(internalLogger.info).toHaveBeenCalledOnce()
		expect(externalLogger.info).not.toHaveBeenCalled()
		atom<number>({
			key: `count`,
			default: 0,
		})
		expect(internalLogger.error).toHaveBeenCalledOnce()
		expect(externalLogger.error).not.toHaveBeenCalled()
		const countTimeline = timeline({
			key: `count`,
			scope: [countAtom],
		})
		undo(countTimeline)
		expect(internalLogger.warn).toHaveBeenCalledOnce()
		expect(externalLogger.warn).not.toHaveBeenCalled()
		getState(countAtom)
		getState(countAtom)
		expect(externalLogger.info).toHaveBeenCalledOnce()
		internalLogger.filter = (icon) => icon === `❌`
		atom<number>({
			key: `count`,
			default: 0,
		})
		expect(externalLogger.info).toHaveBeenCalledOnce()
		internalLogger.filter = (icon) => icon === `💁`
		undo(countTimeline)
		expect(externalLogger.warn).toHaveBeenCalledOnce()
	})
	it(`refines messages as needed, keeping large objects out of logs`, () => {
		class MyComplexThing {
			public id: string
			public constructor(id: string) {
				this.id = id
			}
		}
		internalLogger.filter = (...params) => {
			let idx = 0
			for (const param of params) {
				if (param instanceof MyComplexThing) {
					params[idx] = `Thing:${param.id}`
				}
				idx++
			}
			return params
		}
		internalLogger.error(
			`❌`,
			`atom`,
			`thingy`,
			`errored`,
			new MyComplexThing(`123`),
		)
		expect(externalLogger.error).toHaveBeenLastCalledWith(
			expect.any(String),
			`atom`,
			`thingy`,
			expect.any(String),
			`Thing:123`,
		)
		internalLogger.warn(
			`💁`,
			`atom`,
			`thingy`,
			`warned`,
			new MyComplexThing(`456`),
		)
		expect(externalLogger.warn).toHaveBeenLastCalledWith(
			expect.any(String),
			`atom`,
			`thingy`,
			expect.any(String),
			`Thing:456`,
		)
		internalLogger.info(
			`👍`,
			`atom`,
			`thingy`,
			`infoed`,
			new MyComplexThing(`789`),
		)
		expect(externalLogger.info).toHaveBeenLastCalledWith(
			expect.any(String),
			`atom`,
			`thingy`,
			expect.any(String),
			`Thing:789`,
		)
	})
})

describe(`simpleLog`, () => {
	it(`writes formatted messages to the requested console method`, () => {
		const info = vitest
			.spyOn(console, `info`)
			.mockImplementation(() => undefined)
		const payload = { newValue: 1 }

		try {
			simpleLog(`info`, `atom.io`)(`⭐`, `atom`, `count`, `set`, payload)

			expect(info).toHaveBeenCalledWith(`atom.io ⭐ atom \`count\` set`, payload)
		} finally {
			info.mockRestore()
		}
	})
	it(`exposes an unprefixed default logger`, () => {
		const warn = vitest
			.spyOn(console, `warn`)
			.mockImplementation(() => undefined)

		try {
			simpleLogger.warn(`💁`, `timeline`, `count`, `cannot undo`)

			expect(warn).toHaveBeenCalledWith(`💁 timeline \`count\` cannot undo`)
		} finally {
			warn.mockRestore()
		}
	})
})
