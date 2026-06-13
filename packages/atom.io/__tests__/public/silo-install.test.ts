import type { Logger } from "atom.io"
import { atomFamily, runTransaction, Silo, transaction } from "atom.io"
import * as Internal from "atom.io/internal"
import { NotFoundError } from "atom.io/internal"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"

import * as Utils from "../__util__/index.ts"

let logger: Logger
const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	setTestLogLevel(null)
	logger = Internal.IMPLICIT.STORE.logger = Utils.createNullLogger()
	vitest.spyOn(logger, `error`)
	vitest.spyOn(logger, `warn`)
	vitest.spyOn(logger, `info`)
	vitest.spyOn(Utils, `stdout`)
})

describe(`silo.install`, () => {
	it(`installs states from another store`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const mySilo = new Silo({
			name: `my-silo`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		let caught: Error | undefined
		try {
			mySilo.getState(countAtoms, `example`)
		} catch (thrown) {
			if (thrown instanceof NotFoundError) {
				caught = thrown
			}
		}
		expect(caught).toBeInstanceOf(NotFoundError)
		mySilo.install([countAtoms])
		expect(mySilo.getState(countAtoms, `example`)).toBe(0)
		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.error).not.toHaveBeenCalled()
	})
	it(`fails if one the silo store is undergoing a transaction`, () => {
		const mySilo = new Silo({
			name: `my-silo`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		const targetLogger = (mySilo.store.logger = Utils.createNullLogger())
		vitest.spyOn(targetLogger, `error`)
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const myIllConceivedProcedureTX = transaction<() => void>({
			key: `my-ill-conceived-procedure`,
			do: () => {
				mySilo.install([countAtoms])
			},
		})
		mySilo.install([myIllConceivedProcedureTX])

		mySilo.runTransaction(myIllConceivedProcedureTX)()
		expect(targetLogger.error).toHaveBeenCalledTimes(1)

		runTransaction(myIllConceivedProcedureTX)()
		expect(logger.error).toHaveBeenCalledTimes(1)
		expect(logger.warn).not.toHaveBeenCalled()
	})
})
