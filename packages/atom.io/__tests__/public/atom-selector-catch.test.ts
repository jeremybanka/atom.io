/* oxlint-disable typescript/require-await */

import type { AtomToken, Loadable } from "atom.io"
import { atom, atomFamily, getState, selector, selectorFamily } from "atom.io"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"

import * as Utils from "../__util__/index.ts"

const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	setTestLogLevel(null)
	vitest.spyOn(Utils, `stdout`).mockReset()
	vitest.spyOn(Utils, `stdout0`).mockReset()
	vitest.spyOn(Utils, `stdout`)
})

describe(`immediate states that throw`, () => {
	describe(`atom`, () => {
		it(`(happy) catches a thrown error`, () => {
			class ClientError extends Error {}

			const retrieveState = (): number => {
				throw new ClientError(`😤`)
			}

			const countAtom: AtomToken<number, null, ClientError> = atom({
				key: `count`,
				default: retrieveState,
				catch: [ClientError],
			})

			const err = getState(countAtom)

			expect(err).toBeInstanceOf(ClientError)
		})
		it(`(sad) doesn't catch an error category it doesn't know about`, () => {
			class ClientError extends Error {}

			const retrieveState = (): number => {
				throw new Error(`😤`) // not a ClientError
			}

			const countAtom = atom<number, ClientError>({
				key: `count`,
				default: retrieveState,
				catch: [ClientError],
			})

			expect(() => getState(countAtom)).toThrow(Error)
		})
	})
	describe(`atom family`, () => {
		it(`(happy) catches a thrown error`, () => {
			class ClientError extends Error {}

			const retrieveState = (): number => {
				throw new ClientError(`😤`)
			}

			const countAtoms = atomFamily<number, string, ClientError>({
				key: `count`,
				default: retrieveState,
				catch: [ClientError],
			})

			const err = getState(countAtoms, `example`)

			expect(err).toBeInstanceOf(ClientError)
		})
		it(`(sad) doesn't catch an error category it doesn't know about`, () => {
			class ClientError extends Error {}

			const retrieveState = (): number => {
				throw new Error(`😤`) // not a ClientError
			}

			const countAtoms = atomFamily<number, string, ClientError>({
				key: `count`,
				default: retrieveState,
				catch: [ClientError],
			})

			expect(() => getState(countAtoms, `example`)).toThrow(Error)
		})
	})
	describe(`selector`, () => {
		it(`(happy) catches a thrown error`, () => {
			class ClientError extends Error {}

			const retrieveState = (): number => {
				throw new ClientError(`😤`)
			}

			const countSelector = selector<number, ClientError>({
				key: `count`,
				get: retrieveState,
				catch: [ClientError],
			})

			const err = getState(countSelector)

			expect(err).toBeInstanceOf(ClientError)
		})
		it(`(sad) doesn't catch an error category it doesn't know about`, () => {
			class ClientError extends Error {}

			const retrieveState = (): number => {
				throw new Error(`😤`) // not a ClientError
			}

			const countSelector = selector<number, ClientError>({
				key: `count`,
				get: retrieveState,
				catch: [ClientError],
			})

			expect(() => getState(countSelector)).toThrow(Error)
		})
	})
	describe(`selector family`, () => {
		it(`(happy) catches a thrown error`, () => {
			class ClientError extends Error {}

			const retrieveState = (): number => {
				throw new ClientError(`😤`)
			}

			const countSelectors = selectorFamily<number, string, ClientError>({
				key: `count`,
				get: () => retrieveState,
				catch: [ClientError],
			})

			const err = getState(countSelectors, `example`)

			expect(err).toBeInstanceOf(ClientError)
		})
		it(`(sad) doesn't catch an error category it doesn't know about`, () => {
			class ClientError extends Error {}

			const retrieveState = (): number => {
				throw new Error(`😤`) // not a ClientError
			}

			const countSelectors = selectorFamily<number, string, ClientError>({
				key: `count`,
				get: () => retrieveState,
				catch: [ClientError],
			})

			expect(() => getState(countSelectors, `example`)).toThrow(Error)
		})
	})
})

describe(`loadable states that reject`, async () => {
	describe(`loadable atom`, () => {
		it(`catches a rejected promise`, async () => {
			class ClientError extends Error {}

			const retrieveState = async (): Promise<number> => {
				throw new ClientError(`😤`)
			}

			const countAtom = atom<Loadable<number>, ClientError>({
				key: `count`,
				default: retrieveState,
				catch: [ClientError],
			})

			const err = await getState(countAtom)

			expect(err).toBeInstanceOf(ClientError)
		})
		it(`(sad) doesn't catch an error category it doesn't know about`, async () => {
			class ClientError extends Error {}
			const retrieveState = async (): Promise<number> => {
				throw new Error(`😤`) // not a ClientError
			}
			const countAtom = atom<Loadable<number>, ClientError>({
				key: `count`,
				default: retrieveState,
				catch: [ClientError],
			})

			let err: any
			try {
				await getState(countAtom)
			} catch (e) {
				err = e
			}
			expect(err).toBeInstanceOf(Error)
		})
	})
	describe(`loadable atom family`, () => {
		it(`(happy) catches a thrown error`, async () => {
			class ClientError extends Error {}

			const retrieveState = async (): Promise<number> => {
				throw new ClientError(`😤`)
			}

			const countAtoms = atomFamily<Loadable<number>, string, ClientError>({
				key: `count`,
				default: retrieveState,
				catch: [ClientError],
			})

			const err = await getState(countAtoms, `example`)

			expect(err).toBeInstanceOf(ClientError)
		})
		it(`(sad) doesn't catch an error category it doesn't know about`, async () => {
			class ClientError extends Error {}
			const retrieveState = async (): Promise<number> => {
				throw new Error(`😤`) // not a ClientError
			}
			const countAtoms = atomFamily<Loadable<number>, string, ClientError>({
				key: `count`,
				default: retrieveState,
				catch: [ClientError],
			})
			let err: any
			try {
				await getState(countAtoms, `example`)
			} catch (e) {
				err = e
			}
			expect(err).toBeInstanceOf(Error)
		})
	})
	describe(`loadable selector`, async () => {
		it(`(happy) catches a rejected promise`, async () => {
			class ClientError extends Error {}

			const retrieveState = async (): Promise<number> => {
				throw new ClientError(`😤`)
			}

			const countSelector = selector<Loadable<number>, ClientError>({
				key: `count`,
				get: retrieveState,
				catch: [ClientError],
			})

			const err = await getState(countSelector)

			expect(err).toBeInstanceOf(ClientError)
		})
		it(`(sad) doesn't catch an error category it doesn't know about`, async () => {
			class ClientError extends Error {}

			const retrieveState = async (): Promise<number> => {
				throw new Error(`😤`) // not a ClientError
			}

			const countSelector = selector<Loadable<number>, ClientError>({
				key: `count`,
				get: retrieveState,
				catch: [ClientError],
			})

			let err: any
			try {
				await getState(countSelector)
			} catch (e) {
				err = e
			}
			expect(err).toBeInstanceOf(Error)
		})
	})
	describe(`loadable selector family`, async () => {
		it(`(happy) catches a thrown error`, async () => {
			class ClientError extends Error {}

			const retrieveState = async (): Promise<number> => {
				throw new ClientError(`😤`)
			}

			const countSelectors = selectorFamily<
				Loadable<number>,
				string,
				ClientError
			>({
				key: `count`,
				get: () => retrieveState,
				catch: [ClientError],
			})

			const err = await getState(countSelectors, `example`)

			expect(err).toBeInstanceOf(ClientError)
		})
		it(`(sad) doesn't catch an error category it doesn't know about`, async () => {
			class ClientError extends Error {}
			const retrieveState = async (): Promise<number> => {
				throw new Error(`😤`) // not a ClientError
			}
			const countSelectors = selectorFamily<
				Loadable<number>,
				string,
				ClientError
			>({
				key: `count`,
				get: () => retrieveState,
				set: () => () => {},
				catch: [ClientError],
			})
			let err: any
			try {
				await getState(countSelectors, `example`)
			} catch (e) {
				err = e
			}
			expect(err).toBeInstanceOf(Error)
		})
	})
})
