import type { Canonical } from "atom.io/foundations/canonical"
import { mosaicDomain } from "atom.io/realtime"
import { UList } from "atom.io/transceivers/u-list"
import { z } from "zod"

import { Silo } from "../../../src/main/index.ts"

const makeSilo = (name: string) =>
	new Silo({ isProduction: false, lifespan: `ephemeral`, name })

describe(`Mosaic Domains`, () => {
	test(`a one-member domain coordinates an ordinary atom and inferred config`, async () => {
		const silo = makeSilo(`one-member`)
		const bodyAtom = silo.atom<string>({ default: `hello`, key: `body` })
		const bodyLengthSelector = silo.selector<number>({
			get: ({ get }) => get(bodyAtom).length,
			key: `bodyLength`,
		})
		const document = mosaicDomain({
			configSchema: z.object({ room: z.string() }).transform(({ room }) => ({
				room: room.toUpperCase(),
			})),
			key: `document`,
			members: {
				body: { role: `durable`, schema: z.string(), token: bodyAtom },
			},
			version: 1,
		})
		const instance = await document.activate({
			config: { room: `alpha` },
			instance: `notes/alpha`,
			store: silo.store,
		})

		expect(instance.config).toEqual({ room: `ALPHA` })
		expectTypeOf(instance.config).toEqualTypeOf<{ room: string }>()
		silo.setState(bodyAtom, `world`)
		expect(silo.getState(bodyAtom)).toBe(`world`)
		expect(silo.getState(bodyLengthSelector)).toBe(5)
		expect(instance.address(`body`)).toEqual({
			domain: {
				definition: { key: `document`, version: 1 },
				instance: `notes/alpha`,
			},
			member: `body`,
		})
		expect(instance.definitionIdentity).toEqual({ key: `document`, version: 1 })
		expect(await instance.validateValue(`body`, `remote`)).toBe(`remote`)
		await expect(instance.validateValue(`body`, 2)).rejects.toThrow(
			`Mosaic Domain member "body" value failed validation`,
		)
	})

	test(`members retain ordinary subscriptions, selectors, and transactions`, async () => {
		const silo = makeSilo(`ordinary-state`)
		const titleAtom = silo.atom<string>({ default: `Untitled`, key: `title` })
		const revisionAtom = silo.atom<number>({ default: 0, key: `revision` })
		const summarySelector = silo.selector<string>({
			get: ({ get }) => `${get(titleAtom)}@${get(revisionAtom)}`,
			key: `summary`,
		})
		const renameTransaction = silo.transaction<(title: string) => void>({
			do: ({ set }, title) => {
				set(titleAtom, title)
				set(revisionAtom, (revision) => revision + 1)
			},
			key: `rename`,
		})
		const domain = mosaicDomain({
			configSchema: z.object({}),
			key: `ordinary-state`,
			members: {
				revision: {
					role: `durable`,
					schema: z.number(),
					token: revisionAtom,
				},
				summary: { role: `derived`, token: summarySelector },
				title: { role: `durable`, schema: z.string(), token: titleAtom },
			},
			version: 1,
		})
		const instance = await domain.activate({
			config: {},
			instance: `project/one`,
			store: silo.store,
		})
		const updates = vi.fn()
		const unsubscribe = silo.subscribe(summarySelector, updates)

		silo.runTransaction(renameTransaction)(`Notes`)

		expect(silo.getState(summarySelector)).toBe(`Notes@1`)
		expect(updates).toHaveBeenCalledTimes(1)
		unsubscribe()
		instance[Symbol.dispose]()
	})

	test(`parses family addresses without allocation and acquires explicitly`, async () => {
		const silo = makeSilo(`families`)
		const blocksAtoms = silo.atomFamily<string, string>({
			default: ``,
			key: `blocks`,
		})
		const domain = mosaicDomain({
			configSchema: z.object({}),
			key: `blocks-domain`,
			members: {
				blocks: {
					keySchema: z.string().min(1),
					role: `durable`,
					schema: z.string(),
					token: blocksAtoms,
				},
			},
			version: 2,
		})
		const instance = await domain.activate({
			config: {},
			instance: `document/one`,
			store: silo.store,
		})
		const address = instance.address(`blocks`, `late`)
		const atomsBeforeParsing = silo.store.atoms.size
		const parsed = await instance.parseAddress(
			JSON.parse(JSON.stringify(address)),
		)

		expect(parsed.address).toEqual(address)
		expect(silo.store.atoms.size).toBe(atomsBeforeParsing)
		const mutableParsed = parsed as {
			address: {
				domain: { instance: string }
				key: string
				member: string
			}
		}
		mutableParsed.address.domain.instance = `forged`
		mutableParsed.address.key = `forged`
		mutableParsed.address.member = `forged`

		const acquired = await instance.acquire(parsed)

		expect(acquired.token).toEqual(silo.findState(blocksAtoms, `late`))
		silo.setState(acquired.token, `created after activation`)
		expect(silo.store.atoms.size).toBe(atomsBeforeParsing + 1)
		expect(silo.getState(blocksAtoms, `late`)).toBe(`created after activation`)
		await expect(instance.parseAddress({ ...address, key: `` })).rejects.toThrow(
			`Mosaic Domain member "blocks" key failed validation`,
		)
		await expect(
			instance.parseAddress({
				...address,
				domain: {
					definition: { key: `other`, version: 2 },
					instance: `document/one`,
				},
			}),
		).rejects.toThrow(`another domain definition`)
	})

	test(`models local, derived, and ephemeral lifecycle without durable claims`, async () => {
		const silo = makeSilo(`roles`)
		const draftAtom = silo.atom<string>({ default: ``, key: `draft` })
		const cursorsAtoms = silo.atomFamily<number, string>({
			default: 0,
			key: `cursors`,
		})
		const lengthSelector = silo.selector<number>({
			get: ({ get }) => get(draftAtom).length,
			key: `length`,
		})
		const members = {
			cursor: {
				keySchema: z.string(),
				role: `ephemeral`,
				schema: z.number().int().nonnegative(),
				token: cursorsAtoms,
			},
			draft: { role: `local`, token: draftAtom },
			length: { role: `derived`, token: lengthSelector },
		} as const
		const first = mosaicDomain({
			configSchema: z.object({}),
			key: `roles-one`,
			members,
			version: 1,
		})
		const second = mosaicDomain({
			configSchema: z.object({}),
			key: `roles-two`,
			members,
			version: 1,
		})

		const firstInstance = await first.activate({
			config: {},
			instance: `roles/one`,
			store: silo.store,
		})
		const secondInstance = await second.activate({
			config: {},
			instance: `roles/two`,
			store: silo.store,
		})
		expect(await firstInstance.validateValue(`cursor`, 3)).toBe(3)
		await expect(
			// @ts-expect-error Local members do not accept remote values.
			firstInstance.validateValue(`draft`, `remote`),
		).rejects.toThrow(`does not accept remote values`)
		expect(() => {
			// @ts-expect-error Local members do not have transport addresses.
			firstInstance.address(`draft`)
		}).toThrow(`not remotely addressable`)
		expect(() => {
			// @ts-expect-error Derived members do not have transport addresses.
			firstInstance.address(`length`)
		}).toThrow(`not remotely addressable`)
		await expect(
			firstInstance.parseAddress({
				domain: firstInstance.identity,
				member: `draft`,
			}),
		).rejects.toThrow(`not remotely addressable`)
		silo.setState(draftAtom, `local`)
		expect(silo.getState(lengthSelector)).toBe(5)
		firstInstance[Symbol.dispose]()
		secondInstance[Symbol.dispose]()
	})

	test(`durable claims are Store-local and released by instance disposal`, async () => {
		const uno = makeSilo(`uno`)
		const dos = makeSilo(`dos`)
		// eslint-disable-next-line atom.io/naming-convention
		const UNO__bodyAtom = uno.atom<string>({ default: ``, key: `body` })
		// eslint-disable-next-line atom.io/naming-convention
		const DOS__bodyAtom = dos.atom<string>({ default: ``, key: `body` })
		const define = (key: string, token: typeof UNO__bodyAtom) =>
			mosaicDomain({
				configSchema: z.object({}),
				key,
				members: {
					body: { role: `durable`, schema: z.string(), token },
				},
				version: 1,
			})
		const first = define(`first`, UNO__bodyAtom)
		const competing = define(`competing`, UNO__bodyAtom)
		const equivalentInAnotherStore = define(`other-store`, DOS__bodyAtom)
		const firstInstance = await first.activate({
			config: {},
			instance: `first/one`,
			store: uno.store,
		})

		await expect(
			competing.activate({
				config: {},
				instance: `competing/one`,
				store: uno.store,
			}),
		).rejects.toThrow(`already owned by domain "first@1#first/one"`)
		await expect(
			equivalentInAnotherStore.activate({
				config: {},
				instance: `other-store/one`,
				store: dos.store,
			}),
		).resolves.toBeDefined()

		firstInstance[Symbol.dispose]()
		expect(firstInstance.disposed).toBe(true)
		await expect(
			competing.activate({
				config: {},
				instance: `competing/one`,
				store: uno.store,
			}),
		).resolves.toBeDefined()
	})

	test(`intensional family claims conflict with individual family members`, async () => {
		const silo = makeSilo(`family-claims`)
		const blocksAtoms = silo.atomFamily<string, string>({
			default: ``,
			key: `blocks`,
		})
		const lateBlockAtom = silo.findState(blocksAtoms, `late`)
		silo.getState(lateBlockAtom)
		const familyDomain = mosaicDomain({
			configSchema: z.object({}),
			key: `family-owner`,
			members: {
				blocks: {
					keySchema: z.string(),
					role: `durable`,
					schema: z.string(),
					token: blocksAtoms,
				},
			},
			version: 1,
		})
		const memberDomain = mosaicDomain({
			configSchema: z.object({}),
			key: `member-owner`,
			members: {
				block: { role: `durable`, schema: z.string(), token: lateBlockAtom },
			},
			version: 1,
		})
		const instance = await familyDomain.activate({
			config: {},
			instance: `family/one`,
			store: silo.store,
		})

		await expect(
			memberDomain.activate({
				config: {},
				instance: `member/one`,
				store: silo.store,
			}),
		).rejects.toThrow(`already owned by domain "family-owner@1#family/one"`)
		instance[Symbol.dispose]()
		const memberInstance = await memberDomain.activate({
			config: {},
			instance: `member/one`,
			store: silo.store,
		})
		await expect(
			familyDomain.activate({
				config: {},
				instance: `family/one`,
				store: silo.store,
			}),
		).rejects.toThrow(`already owned by domain "member-owner@1#member/one"`)
		memberInstance[Symbol.dispose]()
	})

	test(`rejects overlapping durable claims inside one activation`, async () => {
		const silo = makeSilo(`overlapping-claims`)
		const blocksAtoms = silo.atomFamily<string, string>({
			default: ``,
			key: `blocks`,
		})
		const blockAtom = silo.findState(blocksAtoms, `one`)
		silo.getState(blockAtom)
		const domain = mosaicDomain({
			configSchema: z.object({}),
			key: `overlapping`,
			members: {
				block: { role: `durable`, schema: z.string(), token: blockAtom },
				blocks: {
					keySchema: z.string(),
					role: `durable`,
					schema: z.string(),
					token: blocksAtoms,
				},
			},
			version: 1,
		})

		await expect(
			domain.activate({
				config: {},
				instance: `overlapping/one`,
				store: silo.store,
			}),
		).rejects.toThrow(`already owned by domain "overlapping@1#overlapping/one"`)
	})

	test(`claim failures are atomic`, async () => {
		const silo = makeSilo(`atomic-claims`)
		const occupiedAtom = silo.atom<number>({ default: 0, key: `occupied` })
		const availableAtom = silo.atom<number>({ default: 0, key: `available` })
		const domain = (
			key: string,
			members: Record<
				string,
				{ role: `durable`; schema: z.ZodNumber; token: typeof occupiedAtom }
			>,
		) =>
			mosaicDomain({
				configSchema: z.object({}),
				key,
				members,
				version: 1,
			})
		const owner = await domain(`owner`, {
			occupied: { role: `durable`, schema: z.number(), token: occupiedAtom },
		}).activate({ config: {}, instance: `owner/one`, store: silo.store })
		await expect(
			domain(`partial`, {
				available: { role: `durable`, schema: z.number(), token: availableAtom },
				occupied: { role: `durable`, schema: z.number(), token: occupiedAtom },
			}).activate({
				config: {},
				instance: `partial/one`,
				store: silo.store,
			}),
		).rejects.toThrow(`already owned`)
		const successor = await domain(`successor`, {
			available: { role: `durable`, schema: z.number(), token: availableAtom },
		}).activate({ config: {}, instance: `successor/one`, store: silo.store })
		owner[Symbol.dispose]()
		successor[Symbol.dispose]()
	})

	test(`invalid config claims nothing and activation rejects duplicate instances`, async () => {
		const silo = makeSilo(`config`)
		const countAtom = silo.atom<number>({ default: 0, key: `count` })
		const define = (key: string) =>
			mosaicDomain({
				configSchema: z.object({ room: z.string().min(1) }),
				key,
				members: {
					count: { role: `durable`, schema: z.number(), token: countAtom },
				},
				version: 1,
			})
		const invalid = define(`invalid`)
		await expect(
			invalid.activate({
				config: { room: `` },
				instance: `invalid/one`,
				store: silo.store,
			}),
		).rejects.toThrow(`config failed validation`)
		const valid = define(`valid`)
		await expect(
			valid.activate({
				config: { room: `room` },
				instance: ``,
				store: silo.store,
			}),
		).rejects.toThrow(`instance cannot be empty`)
		const instance = await valid.activate({
			config: { room: `room` },
			instance: `valid/one`,
			store: silo.store,
		})
		await expect(
			valid.activate({
				config: { room: `room` },
				instance: `valid/two`,
				store: silo.store,
			}),
		).rejects.toThrow(`already active`)
		instance[Symbol.dispose]()
	})

	test(`rejects incoherent membership declarations at definition time`, () => {
		const silo = makeSilo(`invalid-membership`)
		const stateAtom = silo.atom<number>({ default: 0, key: `state` })
		expect(() =>
			mosaicDomain({
				configSchema: z.object({}),
				key: `bad`,
				members: {
					first: { role: `durable`, schema: z.number(), token: stateAtom },
					second: { role: `local`, token: stateAtom },
				},
				version: 1,
			}),
		).toThrow(`refer to the same token`)
	})

	test(`rejects malformed identities and membership definitions`, () => {
		const silo = makeSilo(`malformed-definitions`)
		const stateAtom = silo.atom<number>({ default: 0, key: `state` })
		const stateAtoms = silo.atomFamily<number, string>({
			default: 0,
			key: `state`,
		})
		const stateSelector = silo.selector<number>({
			get: ({ get }) => get(stateAtom),
			key: `state`,
		})
		const validMember = {
			state: { role: `durable`, schema: z.number(), token: stateAtom },
		} as const
		const define = (key: string, version: number, members: never) =>
			mosaicDomain({
				configSchema: z.object({}),
				key,
				members,
				version,
			})

		expect(() => define(``, 1, validMember as never)).toThrow(`cannot be empty`)
		expect(() =>
			define(`unsafe`, Number.MAX_SAFE_INTEGER + 1, validMember as never),
		).toThrow(`positive integer`)
		expect(() => define(`zero`, 0, validMember as never)).toThrow(
			`positive integer`,
		)
		expect(() =>
			define(`empty-member`, 1, {
				"": { role: `durable`, schema: z.number(), token: stateAtom },
			} as never),
		).toThrow(`names cannot be empty`)
		expect(() =>
			define(`family-without-key-schema`, 1, {
				states: { role: `durable`, schema: z.number(), token: stateAtoms },
			} as never),
		).toThrow(`must declare a keySchema`)
		expect(() =>
			define(`singleton-with-key-schema`, 1, {
				state: {
					keySchema: z.string(),
					role: `durable`,
					schema: z.number(),
					token: stateAtom,
				},
			} as never),
		).toThrow(`singleton members must not`)
		expect(() =>
			define(`atom-as-derived`, 1, {
				state: { role: `derived`, token: stateAtom },
			} as never),
		).toThrow(`incompatible with token type "atom"`)
		expect(() =>
			define(`selector-as-durable`, 1, {
				state: {
					role: `durable`,
					schema: z.number(),
					token: stateSelector,
				},
			} as never),
		).toThrow(`incompatible with token type "readonly_pure_selector"`)
		expect(() =>
			define(`missing-schema`, 1, {
				state: { role: `durable`, token: stateAtom },
			} as never),
		).toThrow(`must declare a Standard Schema`)
	})

	test(`rejects malformed addresses and all operations after disposal`, async () => {
		const silo = makeSilo(`malformed-addresses`)
		const bodyAtom = silo.atom<string>({ default: ``, key: `body` })
		const blockAtoms = silo.atomFamily<string, string>({
			default: ``,
			key: `block`,
		})
		const domain = mosaicDomain({
			configSchema: z.object({}),
			key: `addresses`,
			members: {
				blocks: {
					keySchema: z.string().min(1),
					role: `durable`,
					schema: z.string(),
					token: blockAtoms,
				},
				body: { role: `durable`, schema: z.string(), token: bodyAtom },
			},
			version: 1,
		})
		const instance = await domain.activate({
			config: {},
			instance: `addresses/one`,
			store: silo.store,
		})
		const imperativeAddress = instance.address as unknown as (
			member: string,
			...key: readonly Canonical[]
		) => unknown

		expect(() => imperativeAddress(`missing`)).toThrow(`Unknown`)
		expect(() => imperativeAddress(`blocks`)).toThrow(`requires a key`)
		expect(() => imperativeAddress(`body`, `extra`)).toThrow(
			`does not accept a key`,
		)
		await expect(instance.parseAddress(null)).rejects.toThrow(
			`must be an object`,
		)
		await expect(instance.parseAddress(`address`)).rejects.toThrow(
			`must be an object`,
		)
		await expect(
			instance.parseAddress({ domain: null, member: `body` }),
		).rejects.toThrow(`another domain`)
		await expect(
			instance.parseAddress({
				domain: {
					definition: { key: `addresses`, version: 2 },
					instance: `addresses/one`,
				},
				member: `body`,
			}),
		).rejects.toThrow(`another domain definition`)
		await expect(
			instance.parseAddress({
				domain: {
					definition: { key: `addresses`, version: 1 },
					instance: `addresses/two`,
				},
				member: `body`,
			}),
		).rejects.toThrow(`another domain instance`)
		await expect(
			instance.parseAddress({
				domain: instance.identity,
				member: 1,
			}),
		).rejects.toThrow(`unknown member`)
		await expect(
			instance.parseAddress({
				domain: instance.identity,
				member: `toString`,
			}),
		).rejects.toThrow(`unknown member`)
		await expect(
			instance.parseAddress({
				domain: instance.identity,
				key: `extra`,
				member: `body`,
			}),
		).rejects.toThrow(`does not accept a key`)
		const parsed = await instance.parseAddress(instance.address(`body`))
		await expect(instance.acquire(parsed)).resolves.toEqual({
			member: instance.members.body,
			token: bodyAtom,
		})

		instance[Symbol.dispose]()
		instance[Symbol.dispose]()
		expect(() => instance.address(`body`)).toThrow(`disposed`)
		await expect(instance.parseAddress({})).rejects.toThrow(`disposed`)
		await expect(instance.acquire(parsed)).rejects.toThrow(`disposed`)
		await expect(instance.validateValue(`body`, ``)).rejects.toThrow(`disposed`)
	})

	test(`schema outputs are tied to their member values and family keys`, () => {
		const silo = makeSilo(`schema-types`)
		const countAtom = silo.atom<number>({ default: 0, key: `count` })
		const countAtoms = silo.atomFamily<number, string>({
			default: 0,
			key: `count`,
		})
		const selectedAtomsAtom = silo.mutableAtom<UList<number>>({
			class: UList,
			key: `selectedAtoms`,
		})
		mosaicDomain({
			configSchema: z.object({}),
			key: `mutable-snapshot-schema`,
			members: {
				selected: {
					role: `durable`,
					schema: z.array(z.number()).readonly(),
					token: selectedAtomsAtom,
				},
			},
			version: 1,
		})
		mosaicDomain({
			configSchema: z.object({}),
			key: `bad-value-schema`,
			members: {
				count: {
					role: `durable`,
					// @ts-expect-error A remote string cannot be applied to a number atom.
					schema: z.string(),
					token: countAtom,
				},
			},
			version: 1,
		})
		mosaicDomain({
			configSchema: z.object({}),
			key: `bad-key-schema`,
			members: {
				counts: {
					// @ts-expect-error A numeric key cannot address a string-keyed family.
					keySchema: z.number(),
					role: `durable`,
					schema: z.number(),
					token: countAtoms,
				},
			},
			version: 1,
		})
		expect(true).toBe(true)
	})
})
