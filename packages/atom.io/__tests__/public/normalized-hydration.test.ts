import type { Loadable } from "atom.io"
import { Silo } from "atom.io"
import { describe, expect, it } from "vitest"

type RemoteDocument = {
	id: string
	title: string
	version: number
}

type HydrationGuard = `none` | `request` | `request-and-version`

function documentStore() {
	const silo = new Silo({
		name: `normalized-hydration`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	for (const logger of silo.store.loggers) logger.logLevel = null
	const documentAtoms = silo.atomFamily<RemoteDocument | null, string>({
		key: `document`,
		default: null,
	})
	return { silo, documentAtoms }
}

function fixture(guard: HydrationGuard = `none`) {
	const { silo, documentAtoms } = documentStore()
	const refreshRevisionAtom = silo.atom<number>({
		key: `refreshRevision`,
		default: 0,
	})
	const requests: {
		query: string
		resolve: (documents: RemoteDocument[]) => void
		completed: Promise<string[]>
	}[] = []
	const currentRequests = new Map<string, symbol>()

	function loadDocuments(query: string): Promise<string[]> {
		const request = Symbol(query)
		currentRequests.set(query, request)
		const response = Promise.withResolvers<RemoteDocument[]>()
		const completed = response.promise.then((documents) => {
			// These guards are an application-level experiment, not library behavior.
			const mayHydrate =
				guard === `none` || currentRequests.get(query) === request
			if (mayHydrate) {
				for (const document of documents) {
					const current = silo.getState(documentAtoms, document.id)
					if (
						guard === `request-and-version` &&
						current !== null &&
						document.version <= current.version
					) {
						continue
					}
					silo.setState(documentAtoms, document.id, document)
				}
			}
			return documents.map((document) => document.id)
		})
		requests.push({ query, resolve: response.resolve, completed })
		return completed
	}

	const documentKeysAtom = silo.atom<Loadable<string[]>>({
		key: `documentKeys`,
		default: () => loadDocuments(`documents`),
	})
	const documentKeysFromRevisionSelector = silo.selector<Loadable<string[]>>({
		key: `documentKeysFromRevision`,
		get: ({ get }) => {
			get(refreshRevisionAtom)
			return loadDocuments(`documents`)
		},
	})
	const documentKeysForQueryAtoms = silo.atomFamily<Loadable<string[]>, string>({
		key: `documentKeysForQuery`,
		default: loadDocuments,
	})

	return {
		silo,
		documentAtoms,
		documentKeysForQueryAtoms,
		requests,
		keys: { atom: documentKeysAtom, selector: documentKeysFromRevisionSelector },
		refresh(kind: `atom` | `selector`) {
			if (kind === `atom`) silo.resetState(documentKeysAtom)
			else {
				silo.setState(refreshRevisionAtom, (revision) => revision + 1)
				// An unobserved selector recomputes on its next read.
				void silo.getState(documentKeysFromRevisionSelector)
			}
		},
	}
}

function effectFixture(useVersions = true) {
	const { silo, documentAtoms } = documentStore()
	const requests: {
		query: string
		resolve: (documents: RemoteDocument[]) => void
		reject: (reason: Error) => void
		promise: Promise<RemoteDocument[]>
	}[] = []
	const hydratedQueries: string[] = []
	const hydrateDocumentsTransaction = silo.transaction<
		(documents: readonly RemoteDocument[]) => void
	>({
		key: `hydrateDocuments`,
		do: ({ get, set }, documents) => {
			for (const document of documents) {
				const current = get(documentAtoms, document.id)
				if (
					useVersions &&
					current !== null &&
					document.version <= current.version
				) {
					continue
				}
				set(documentAtoms, document.id, document)
			}
		},
	})
	const documentResponseAtoms = silo.atomFamily<
		Loadable<RemoteDocument[]>,
		string,
		Error
	>({
		key: `documentResponse`,
		default: (query) => {
			const response = Promise.withResolvers<RemoteDocument[]>()
			requests.push({ query, ...response })
			return response.promise
		},
		catch: [Error],
		effects: (query) => [
			({ onSet }) => {
				onSet(({ newValue }) => {
					// Observe accepted, resolved state synchronously. Awaiting pending
					// values here would create additional async continuations to guard.
					if (newValue instanceof Promise || newValue instanceof Error) return
					silo.runTransaction(hydrateDocumentsTransaction)(newValue)
					hydratedQueries.push(query)
				})
			},
		],
	})
	const documentKeysFromResponseSelectors = silo.selectorFamily<
		Loadable<Error | string[]>,
		string
	>({
		key: `documentKeysFromResponse`,
		get:
			(query) =>
			async ({ get }) => {
				const documents = await get(documentResponseAtoms, query)
				if (documents instanceof Error) return documents
				return documents.map((document) => document.id)
			},
	})

	return {
		silo,
		documentAtoms,
		documentResponseAtoms,
		documentKeysFromResponseSelectors,
		requests,
		hydratedQueries,
	}
}

const original: RemoteDocument = {
	id: `document-1`,
	title: `Original`,
	version: 1,
}
const updated: RemoteDocument = { ...original, title: `Updated`, version: 2 }
const added: RemoteDocument = {
	id: `document-2`,
	title: `Added`,
	version: 1,
}

describe(`normalized hydration`, () => {
	it.each([
		[`atom`, `none`],
		[`selector`, `none`],
		[`atom`, `request`],
		[`selector`, `request`],
		[`atom`, `request-and-version`],
		[`selector`, `request-and-version`],
	] as const)(
		`hydrates on initial load and an ordinary %s refresh with the %s guard`,
		async (kind, guard) => {
			const { silo, keys, documentAtoms, requests, refresh } = fixture(guard)
			const initial = silo.getState(keys[kind])
			expect(initial).toBeInstanceOf(Promise)
			expect(requests).toHaveLength(1)
			requests[0].resolve([original])
			expect(await initial).toEqual([original.id])
			expect(silo.getState(documentAtoms, original.id)).toEqual(original)

			refresh(kind)
			expect(requests).toHaveLength(2)
			expect(silo.getState(keys[kind])).toBeInstanceOf(Promise)
			requests[1].resolve([updated, added])
			expect(await silo.getState(keys[kind])).toEqual([updated.id, added.id])
			expect(silo.getState(documentAtoms, original.id)).toEqual(updated)
		},
	)

	// Characterization: these assertions reproduce the current bug. The key list
	// stays fresh, but superseded loaders still overwrite the normalized entity.
	it.each([`atom`, `selector`] as const)(
		`currently lets repeated %s invalidations overwrite entities from a newer response`,
		async (kind) => {
			const { silo, keys, documentAtoms, requests, refresh } = fixture()
			const initial = silo.getState(keys[kind])
			requests[0].resolve([original])
			await initial

			refresh(kind)
			const slow = requests[1]
			const superseded = silo.getState(keys[kind])
			refresh(kind)
			const fast = requests[2]
			const latest = silo.getState(keys[kind])
			expect(requests).toHaveLength(3)
			// A pending Future can keep its identity while its source is replaced.
			expect(superseded).toBe(latest)

			fast.resolve([updated, added])
			expect(await latest).toEqual([updated.id, added.id])
			expect(silo.getState(documentAtoms, original.id)).toEqual(updated)

			slow.resolve([original])
			// Await the obsolete loader itself, not the Future following the latest.
			await slow.completed
			expect(silo.getState(keys[kind])).toEqual([updated.id, added.id])
			expect(silo.getState(documentAtoms, original.id)).toEqual(original)
		},
	)

	it(`currently lets different query keys overwrite a shared entity`, async () => {
		const { silo, documentKeysForQueryAtoms, documentAtoms, requests } =
			fixture()
		const slow = silo.getState(documentKeysForQueryAtoms, `all`)
		const fast = silo.getState(documentKeysForQueryAtoms, `recent`)
		expect(requests.map(({ query }) => query)).toEqual([`all`, `recent`])

		requests[1].resolve([updated, added])
		await fast
		expect(silo.getState(documentAtoms, original.id)).toEqual(updated)

		requests[0].resolve([original])
		await slow
		expect(silo.getState(documentKeysForQueryAtoms, `all`)).toEqual([
			original.id,
		])
		expect(silo.getState(documentKeysForQueryAtoms, `recent`)).toEqual([
			updated.id,
			added.id,
		])
		expect(silo.getState(documentAtoms, original.id)).toEqual(original)
	})

	describe(`application guard experiment`, () => {
		it.each([`atom`, `selector`] as const)(
			`revokes hydration permission as soon as a %s load is superseded`,
			async (kind) => {
				const { silo, keys, documentAtoms, requests, refresh } =
					fixture(`request`)
				const initial = silo.getState(keys[kind])
				requests[0].resolve([original])
				await initial

				refresh(kind)
				refresh(kind)
				refresh(kind)
				expect(requests).toHaveLength(4)
				requests[1].resolve([{ ...original, title: `Obsolete` }])
				await requests[1].completed
				expect(silo.getState(documentAtoms, original.id)).toEqual(original)
				expect(silo.getState(keys[kind])).toBeInstanceOf(Promise)

				requests[3].resolve([updated, added])
				expect(await silo.getState(keys[kind])).toEqual([updated.id, added.id])
				expect(silo.getState(documentAtoms, original.id)).toEqual(updated)

				requests[2].resolve([original])
				await requests[2].completed
				expect(silo.getState(documentAtoms, original.id)).toEqual(updated)
				expect(silo.getState(keys[kind])).toEqual([updated.id, added.id])
			},
		)

		it.each([`request`, `request-and-version`] as const)(
			`handles shared entities using the %s guard`,
			async (guard) => {
				const { silo, documentKeysForQueryAtoms, documentAtoms, requests } =
					fixture(guard)
				// Start the query with older data last: request start order cannot tell
				// us which server snapshot contains the newer record.
				const newer = silo.getState(documentKeysForQueryAtoms, `recent`)
				const older = silo.getState(documentKeysForQueryAtoms, `all`)
				requests[0].resolve([updated, added])
				await newer
				expect(silo.getState(documentAtoms, original.id)).toEqual(updated)

				requests[1].resolve([original])
				await older
				expect(silo.getState(documentAtoms, original.id)).toEqual(
					guard === `request-and-version` ? updated : original,
				)
				expect(silo.getState(documentKeysForQueryAtoms, `all`)).toEqual([
					original.id,
				])
				expect(silo.getState(documentKeysForQueryAtoms, `recent`)).toEqual([
					updated.id,
					added.id,
				])
			},
		)
	})

	describe(`hydration from an atom effect`, () => {
		it(`hydrates initial and refreshed results before key subscribers read entities`, async () => {
			const {
				silo,
				documentAtoms,
				documentResponseAtoms,
				documentKeysFromResponseSelectors,
				requests,
				hydratedQueries,
			} = effectFixture()
			const keys = silo.findState(documentKeysFromResponseSelectors, `all`)
			const snapshots: (RemoteDocument | null)[][] = []
			const stop = silo.subscribe(keys, ({ newValue }) => {
				if (newValue instanceof Promise || newValue instanceof Error) return
				snapshots.push(newValue.map((id) => silo.getState(documentAtoms, id)))
			})
			expect(requests).toHaveLength(1)
			expect(hydratedQueries).toEqual([])
			requests[0].resolve([original])
			expect(await silo.getState(keys)).toEqual([original.id])
			expect(snapshots.at(-1)).toEqual([original])
			expect(hydratedQueries).toEqual([`all`])

			silo.resetState(documentResponseAtoms, `all`)
			expect(requests).toHaveLength(2)
			expect(hydratedQueries).toEqual([`all`])
			requests[1].resolve([updated, added])
			expect(await silo.getState(keys)).toEqual([updated.id, added.id])
			expect(snapshots.at(-1)).toEqual([updated, added])
			expect(snapshots.flat()).not.toContain(null)
			expect(hydratedQueries).toEqual([`all`, `all`])
			stop()
		})

		it.each([`before`, `after`] as const)(
			`ignores superseded responses that resolve %s the latest response`,
			async (order) => {
				const {
					silo,
					documentAtoms,
					documentResponseAtoms,
					documentKeysFromResponseSelectors,
					requests,
					hydratedQueries,
				} = effectFixture(false)
				const keys = silo.findState(documentKeysFromResponseSelectors, `all`)
				const initial = silo.getState(keys)
				requests[0].resolve([original])
				await initial

				silo.resetState(documentResponseAtoms, `all`)
				silo.resetState(documentResponseAtoms, `all`)
				silo.resetState(documentResponseAtoms, `all`)
				expect(requests).toHaveLength(4)
				const obsolete = [requests[1], requests[2]]
				if (order === `before`) {
					for (const request of obsolete) request.resolve([added])
					await Promise.all(obsolete.map(({ promise }) => promise))
					expect(silo.getState(documentAtoms, added.id)).toBe(null)
					expect(silo.getState(keys)).toBeInstanceOf(Promise)
				}

				requests[3].resolve([updated])
				expect(await silo.getState(keys)).toEqual([updated.id])
				if (order === `after`) {
					for (const request of obsolete) request.resolve([original, added])
					await Promise.all(obsolete.map(({ promise }) => promise))
				}
				expect(silo.getState(documentAtoms, original.id)).toEqual(updated)
				expect(silo.getState(documentAtoms, added.id)).toBe(null)
				expect(hydratedQueries).toEqual([`all`, `all`])
			},
		)

		it.each([false, true])(
			`merges shared entities with a version check: %s`,
			async (useVersions) => {
				const {
					silo,
					documentAtoms,
					documentResponseAtoms,
					documentKeysFromResponseSelectors,
					requests,
					hydratedQueries,
				} = effectFixture(useVersions)
				const newer = silo.getState(documentKeysFromResponseSelectors, `recent`)
				const older = silo.getState(documentKeysFromResponseSelectors, `all`)
				requests[0].resolve([updated, added])
				expect(await newer).toEqual([updated.id, added.id])
				requests[1].resolve([original])
				expect(await older).toEqual([original.id])
				expect(silo.getState(documentAtoms, original.id)).toEqual(
					useVersions ? updated : original,
				)
				expect(silo.getState(documentResponseAtoms, `all`)).toEqual([original])
				expect(hydratedQueries).toEqual([`recent`, `all`])
			},
		)

		it(`ignores errors and obsolete successes, then hydrates a successful retry`, async () => {
			const {
				silo,
				documentAtoms,
				documentResponseAtoms,
				documentKeysFromResponseSelectors,
				requests,
				hydratedQueries,
			} = effectFixture()
			const keys = silo.findState(documentKeysFromResponseSelectors, `all`)
			void silo.getState(keys)
			silo.resetState(documentResponseAtoms, `all`)
			const failure = new Error(`Request failed`)
			requests[1].reject(failure)
			expect(await silo.getState(keys)).toBe(failure)
			requests[0].resolve([original])
			await requests[0].promise
			expect(silo.getState(documentAtoms, original.id)).toBe(null)
			expect(hydratedQueries).toEqual([])

			silo.resetState(documentResponseAtoms, `all`)
			requests[2].resolve([updated])
			expect(await silo.getState(keys)).toEqual([updated.id])
			expect(silo.getState(documentAtoms, original.id)).toEqual(updated)
			expect(hydratedQueries).toEqual([`all`])
		})
	})

	describe(`hydration request counts with fetchable entity defaults`, () => {
		it.each([
			[`loader`, `entity`],
			[`effect`, `entity`],
			[`loader`, `metadata`],
			[`effect`, `metadata`],
		] as const)(
			`hydrates in a %s and compares versions from %s`,
			async (phase, versionSource) => {
				const { silo } = documentStore()
				const listRequests: ReturnType<
					typeof Promise.withResolvers<RemoteDocument[]>
				>[] = []
				const detailRequests: string[] = []
				const fetchableDocumentAtoms = silo.atomFamily<
					Loadable<RemoteDocument>,
					string
				>({
					key: `fetchableDocument`,
					default: (id) => {
						detailRequests.push(id)
						return Promise.resolve({
							id,
							title: `Fetched individually`,
							version: 0,
						})
					},
				})
				const documentVersionAtoms = silo.atomFamily<number | null, string>({
					key: `documentVersion`,
					default: null,
				})
				const hydrateFetchableDocumentsTransaction = silo.transaction<
					(documents: readonly RemoteDocument[]) => void
				>({
					key: `hydrateFetchableDocuments`,
					do: ({ get, set }, documents) => {
						for (const document of documents) {
							let currentVersion: number | null
							if (versionSource === `entity`) {
								// A comparison read starts the entity's fetch on a cache miss.
								const current = get(fetchableDocumentAtoms, document.id)
								currentVersion =
									current instanceof Promise ? null : current.version
							} else {
								currentVersion = get(documentVersionAtoms, document.id)
							}
							if (
								currentVersion !== null &&
								document.version <= currentVersion
							) {
								continue
							}
							// Direct writes populate entity atoms without running defaults.
							set(fetchableDocumentAtoms, document.id, document)
							set(documentVersionAtoms, document.id, document.version)
						}
					},
				})
				const documentResponseAtom = silo.atom<Loadable<RemoteDocument[]>>({
					key: `documentResponse`,
					default: () => {
						const response = Promise.withResolvers<RemoteDocument[]>()
						listRequests.push(response)
						return phase === `loader`
							? response.promise.then((documents) => {
									silo.runTransaction(hydrateFetchableDocumentsTransaction)(
										documents,
									)
									return documents
								})
							: response.promise
					},
					effects: [
						({ onSet }) => {
							onSet(({ newValue }) => {
								if (phase !== `effect` || newValue instanceof Promise) return
								silo.runTransaction(hydrateFetchableDocumentsTransaction)(
									newValue,
								)
							})
						},
					],
				})
				const documentKeysFromResponseSelector = silo.selector<
					Loadable<string[]>
				>({
					key: `documentKeysFromResponse`,
					get: async ({ get }) => {
						const documents = await get(documentResponseAtom)
						return documents.map(({ id }) => id)
					},
				})
				const observeRows = ({
					newValue,
				}: {
					newValue: Loadable<readonly string[]>
				}) => {
					if (newValue instanceof Promise) return
					for (const id of newValue) {
						expect(silo.getState(fetchableDocumentAtoms, id)).not.toBeInstanceOf(
							Promise,
						)
					}
				}
				const stopFirst = silo.subscribe(
					documentKeysFromResponseSelector,
					observeRows,
				)
				const stopSecond = silo.subscribe(
					documentKeysFromResponseSelector,
					observeRows,
				)
				const firstRead = silo.getState(documentKeysFromResponseSelector)
				const secondRead = silo.getState(documentKeysFromResponseSelector)
				expect(firstRead).toBe(secondRead)
				expect(listRequests).toHaveLength(1)
				listRequests[0].resolve([original, added])
				expect(await firstRead).toEqual([original.id, added.id])
				expect(detailRequests).toEqual(
					versionSource === `entity` ? [original.id, added.id] : [],
				)

				const third: RemoteDocument = { ...added, id: `document-3` }
				silo.resetState(documentResponseAtom)
				expect(listRequests).toHaveLength(2)
				listRequests[1].resolve([updated, added, third])
				expect(await silo.getState(documentKeysFromResponseSelector)).toEqual([
					updated.id,
					added.id,
					third.id,
				])
				expect(silo.getState(fetchableDocumentAtoms, original.id)).toEqual(
					updated,
				)
				expect(silo.getState(documentResponseAtom)).toEqual([
					updated,
					added,
					third,
				])
				expect(listRequests).toHaveLength(2)
				expect(detailRequests).toEqual(
					versionSource === `entity` ? [original.id, added.id, third.id] : [],
				)
				stopFirst()
				stopSecond()
			},
		)
	})
})
