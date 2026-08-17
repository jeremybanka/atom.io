import type { Canonical } from "atom.io/foundations/canonical"
import { collaborationEnvironment } from "atom.io/realtime"
import { UList } from "atom.io/transceivers/u-list"
import { z } from "zod"

import { Silo } from "../../../src/main/index.ts"

const makeSilo = (name: string) =>
	new Silo({ isProduction: false, lifespan: `ephemeral`, name })

describe(`Mosaic Environments`, () => {
	test(`a one-member environment scopes an ordinary atom and inferred config`, async () => {
		const silo = makeSilo(`one-member`)
		const bodyAtom = silo.atom<string>({ default: `hello`, key: `body` })
		const bodyLengthSelector = silo.selector<number>({
			get: ({ get }) => get(bodyAtom).length,
			key: `bodyLength`,
		})
		const document = collaborationEnvironment({
			configSchema: z.object({ room: z.string() }).transform(({ room }) => ({
				room: room.toUpperCase(),
			})),
			key: `document`,
			members: {
				body: { role: `durable`, schema: z.string(), token: bodyAtom },
			},
			version: 1,
		})
		const scope = await document.activate({
			config: { room: `alpha` },
			instance: `notes/alpha`,
			store: silo.store,
		})

		expect(scope.config).toEqual({ room: `ALPHA` })
		expectTypeOf(scope.config).toEqualTypeOf<{ room: string }>()
		silo.setState(bodyAtom, `world`)
		expect(silo.getState(bodyAtom)).toBe(`world`)
		expect(silo.getState(bodyLengthSelector)).toBe(5)
		expect(scope.address(`body`)).toEqual({
			environment: {
				definition: { key: `document`, version: 1 },
				instance: `notes/alpha`,
			},
			member: `body`,
		})
		expect(scope.definitionIdentity).toEqual({ key: `document`, version: 1 })
		expect(await scope.validateValue(`body`, `remote`)).toBe(`remote`)
		await expect(scope.validateValue(`body`, 2)).rejects.toThrow(
			`Mosaic Environment member "body" value failed validation`,
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
		const environment = collaborationEnvironment({
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
		const scope = await environment.activate({
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
		scope[Symbol.dispose]()
	})

	test(`parses family addresses without allocation and acquires explicitly`, async () => {
		const silo = makeSilo(`families`)
		const blocksAtoms = silo.atomFamily<string, string>({
			default: ``,
			key: `blocks`,
		})
		const environment = collaborationEnvironment({
			configSchema: z.object({}),
			key: `blocks-environment`,
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
		const scope = await environment.activate({
			config: {},
			instance: `document/one`,
			store: silo.store,
		})
		const address = scope.address(`blocks`, `late`)
		const atomsBeforeParsing = silo.store.atoms.size
		const parsed = await scope.parseAddress(JSON.parse(JSON.stringify(address)))

		expect(parsed.address).toEqual(address)
		expect(silo.store.atoms.size).toBe(atomsBeforeParsing)

		const acquired = await scope.acquire(parsed)

		expect(acquired.token).toEqual(silo.findState(blocksAtoms, `late`))
		silo.setState(acquired.token, `created after activation`)
		expect(silo.store.atoms.size).toBe(atomsBeforeParsing + 1)
		expect(silo.getState(blocksAtoms, `late`)).toBe(`created after activation`)
		await expect(scope.parseAddress({ ...address, key: `` })).rejects.toThrow(
			`Mosaic Environment member "blocks" key failed validation`,
		)
		await expect(
			scope.parseAddress({
				...address,
				environment: {
					definition: { key: `other`, version: 2 },
					instance: `document/one`,
				},
			}),
		).rejects.toThrow(`another environment definition`)
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
		const first = collaborationEnvironment({
			configSchema: z.object({}),
			key: `roles-one`,
			members,
			version: 1,
		})
		const second = collaborationEnvironment({
			configSchema: z.object({}),
			key: `roles-two`,
			members,
			version: 1,
		})

		const firstScope = await first.activate({
			config: {},
			instance: `roles/one`,
			store: silo.store,
		})
		const secondScope = await second.activate({
			config: {},
			instance: `roles/two`,
			store: silo.store,
		})
		expect(await firstScope.validateValue(`cursor`, 3)).toBe(3)
		await expect(
			// @ts-expect-error Local members do not accept remote values.
			firstScope.validateValue(`draft`, `remote`),
		).rejects.toThrow(`does not accept remote values`)
		expect(() => {
			// @ts-expect-error Local members do not have transport addresses.
			firstScope.address(`draft`)
		}).toThrow(`not remotely addressable`)
		expect(() => {
			// @ts-expect-error Derived members do not have transport addresses.
			firstScope.address(`length`)
		}).toThrow(`not remotely addressable`)
		await expect(
			firstScope.parseAddress({
				environment: firstScope.identity,
				member: `draft`,
			}),
		).rejects.toThrow(`not remotely addressable`)
		silo.setState(draftAtom, `local`)
		expect(silo.getState(lengthSelector)).toBe(5)
		firstScope[Symbol.dispose]()
		secondScope[Symbol.dispose]()
	})

	test(`durable claims are Store-local and released by scope disposal`, async () => {
		const uno = makeSilo(`uno`)
		const dos = makeSilo(`dos`)
		// eslint-disable-next-line atom.io/naming-convention
		const UNO__bodyAtom = uno.atom<string>({ default: ``, key: `body` })
		// eslint-disable-next-line atom.io/naming-convention
		const DOS__bodyAtom = dos.atom<string>({ default: ``, key: `body` })
		const define = (key: string, token: typeof UNO__bodyAtom) =>
			collaborationEnvironment({
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
		const firstScope = await first.activate({
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
		).rejects.toThrow(`already owned by environment "first@1#first/one"`)
		await expect(
			equivalentInAnotherStore.activate({
				config: {},
				instance: `other-store/one`,
				store: dos.store,
			}),
		).resolves.toBeDefined()

		firstScope[Symbol.dispose]()
		expect(firstScope.disposed).toBe(true)
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
		const familyEnvironment = collaborationEnvironment({
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
		const memberEnvironment = collaborationEnvironment({
			configSchema: z.object({}),
			key: `member-owner`,
			members: {
				block: { role: `durable`, schema: z.string(), token: lateBlockAtom },
			},
			version: 1,
		})
		const scope = await familyEnvironment.activate({
			config: {},
			instance: `family/one`,
			store: silo.store,
		})

		await expect(
			memberEnvironment.activate({
				config: {},
				instance: `member/one`,
				store: silo.store,
			}),
		).rejects.toThrow(`already owned by environment "family-owner@1#family/one"`)
		scope[Symbol.dispose]()
		const memberScope = await memberEnvironment.activate({
			config: {},
			instance: `member/one`,
			store: silo.store,
		})
		await expect(
			familyEnvironment.activate({
				config: {},
				instance: `family/one`,
				store: silo.store,
			}),
		).rejects.toThrow(`already owned by environment "member-owner@1#member/one"`)
		memberScope[Symbol.dispose]()
	})

	test(`rejects overlapping durable claims inside one activation`, async () => {
		const silo = makeSilo(`overlapping-claims`)
		const blocksAtoms = silo.atomFamily<string, string>({
			default: ``,
			key: `blocks`,
		})
		const blockAtom = silo.findState(blocksAtoms, `one`)
		silo.getState(blockAtom)
		const environment = collaborationEnvironment({
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
			environment.activate({
				config: {},
				instance: `overlapping/one`,
				store: silo.store,
			}),
		).rejects.toThrow(
			`already owned by environment "overlapping@1#overlapping/one"`,
		)
	})

	test(`claim failures are atomic`, async () => {
		const silo = makeSilo(`atomic-claims`)
		const occupiedAtom = silo.atom<number>({ default: 0, key: `occupied` })
		const availableAtom = silo.atom<number>({ default: 0, key: `available` })
		const environment = (
			key: string,
			members: Record<
				string,
				{ role: `durable`; schema: z.ZodNumber; token: typeof occupiedAtom }
			>,
		) =>
			collaborationEnvironment({
				configSchema: z.object({}),
				key,
				members,
				version: 1,
			})
		const owner = await environment(`owner`, {
			occupied: { role: `durable`, schema: z.number(), token: occupiedAtom },
		}).activate({ config: {}, instance: `owner/one`, store: silo.store })
		await expect(
			environment(`partial`, {
				available: { role: `durable`, schema: z.number(), token: availableAtom },
				occupied: { role: `durable`, schema: z.number(), token: occupiedAtom },
			}).activate({
				config: {},
				instance: `partial/one`,
				store: silo.store,
			}),
		).rejects.toThrow(`already owned`)
		const successor = await environment(`successor`, {
			available: { role: `durable`, schema: z.number(), token: availableAtom },
		}).activate({ config: {}, instance: `successor/one`, store: silo.store })
		owner[Symbol.dispose]()
		successor[Symbol.dispose]()
	})

	test(`invalid config claims nothing and activation rejects duplicate scopes`, async () => {
		const silo = makeSilo(`config`)
		const countAtom = silo.atom<number>({ default: 0, key: `count` })
		const define = (key: string) =>
			collaborationEnvironment({
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
		const scope = await valid.activate({
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
		scope[Symbol.dispose]()
	})

	test(`rejects incoherent membership declarations at definition time`, () => {
		const silo = makeSilo(`invalid-membership`)
		const stateAtom = silo.atom<number>({ default: 0, key: `state` })
		expect(() =>
			collaborationEnvironment({
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
			collaborationEnvironment({
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
		const environment = collaborationEnvironment({
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
		const scope = await environment.activate({
			config: {},
			instance: `addresses/one`,
			store: silo.store,
		})
		const imperativeAddress = scope.address as unknown as (
			member: string,
			...key: readonly Canonical[]
		) => unknown

		expect(() => imperativeAddress(`missing`)).toThrow(`Unknown`)
		expect(() => imperativeAddress(`blocks`)).toThrow(`requires a key`)
		expect(() => imperativeAddress(`body`, `extra`)).toThrow(
			`does not accept a key`,
		)
		await expect(scope.parseAddress(null)).rejects.toThrow(`must be an object`)
		await expect(scope.parseAddress(`address`)).rejects.toThrow(
			`must be an object`,
		)
		await expect(
			scope.parseAddress({ environment: null, member: `body` }),
		).rejects.toThrow(`another environment`)
		await expect(
			scope.parseAddress({
				environment: {
					definition: { key: `addresses`, version: 2 },
					instance: `addresses/one`,
				},
				member: `body`,
			}),
		).rejects.toThrow(`another environment definition`)
		await expect(
			scope.parseAddress({
				environment: {
					definition: { key: `addresses`, version: 1 },
					instance: `addresses/two`,
				},
				member: `body`,
			}),
		).rejects.toThrow(`another environment instance`)
		await expect(
			scope.parseAddress({
				environment: scope.identity,
				member: 1,
			}),
		).rejects.toThrow(`unknown member`)
		await expect(
			scope.parseAddress({
				environment: scope.identity,
				member: `toString`,
			}),
		).rejects.toThrow(`unknown member`)
		await expect(
			scope.parseAddress({
				environment: scope.identity,
				key: `extra`,
				member: `body`,
			}),
		).rejects.toThrow(`does not accept a key`)
		const parsed = await scope.parseAddress(scope.address(`body`))
		await expect(scope.acquire(parsed)).resolves.toEqual({
			member: scope.members.body,
			token: bodyAtom,
		})

		scope[Symbol.dispose]()
		scope[Symbol.dispose]()
		expect(() => scope.address(`body`)).toThrow(`disposed`)
		await expect(scope.parseAddress({})).rejects.toThrow(`disposed`)
		await expect(scope.acquire(parsed)).rejects.toThrow(`disposed`)
		await expect(scope.validateValue(`body`, ``)).rejects.toThrow(`disposed`)
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
		collaborationEnvironment({
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
		collaborationEnvironment({
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
		collaborationEnvironment({
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
