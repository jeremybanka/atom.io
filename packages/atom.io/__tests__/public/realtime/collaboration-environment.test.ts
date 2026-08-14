import type { Canonical } from "atom.io/foundations/canonical"
import { collaborationEnvironment } from "atom.io/realtime"
import { UList } from "atom.io/transceivers/u-list"
import { z } from "zod"

import { Silo } from "../../../src/main/index.ts"

const makeSilo = (name: string) =>
	new Silo({ isProduction: false, lifespan: `ephemeral`, name })

describe(`collaboration environments`, () => {
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
			store: silo.store,
		})

		expect(scope.config).toEqual({ room: `ALPHA` })
		expectTypeOf(scope.config).toEqualTypeOf<{ room: string }>()
		silo.setState(bodyAtom, `world`)
		expect(silo.getState(bodyAtom)).toBe(`world`)
		expect(silo.getState(bodyLengthSelector)).toBe(5)
		expect(scope.address(`body`)).toEqual({
			environment: { key: `document`, version: 1 },
			member: `body`,
		})
		expect(await scope.validateValue(`body`, `remote`)).toBe(`remote`)
		await expect(scope.validateValue(`body`, 2)).rejects.toThrow(
			`Collaboration member "body" value failed validation`,
		)
	})

	test(`validates family addresses and resolves members minted after activation`, async () => {
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
		const scope = await environment.activate({ config: {}, store: silo.store })
		const address = scope.address(`blocks`, `late`)
		const resolved = await scope.resolve(JSON.parse(JSON.stringify(address)))

		expect(resolved.token).toEqual(silo.findState(blocksAtoms, `late`))
		silo.setState(resolved.token, `created after activation`)
		expect(silo.getState(blocksAtoms, `late`)).toBe(`created after activation`)
		await expect(scope.resolve({ ...address, key: `` })).rejects.toThrow(
			`Collaboration member "blocks" key failed validation`,
		)
		await expect(
			scope.resolve({
				...address,
				environment: { key: `other`, version: 2 },
			}),
		).rejects.toThrow(`belongs to another environment`)
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

		const firstScope = await first.activate({ config: {}, store: silo.store })
		const secondScope = await second.activate({ config: {}, store: silo.store })
		expect(await firstScope.validateValue(`cursor`, 3)).toBe(3)
		await expect(firstScope.validateValue(`draft`, `remote`)).rejects.toThrow(
			`does not accept remote values`,
		)
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
		const firstScope = await first.activate({ config: {}, store: uno.store })

		await expect(
			competing.activate({ config: {}, store: uno.store }),
		).rejects.toThrow(`already owned by environment "first@1"`)
		await expect(
			equivalentInAnotherStore.activate({ config: {}, store: dos.store }),
		).resolves.toBeDefined()

		firstScope[Symbol.dispose]()
		expect(firstScope.disposed).toBe(true)
		await expect(
			competing.activate({ config: {}, store: uno.store }),
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
			store: silo.store,
		})

		await expect(
			memberEnvironment.activate({ config: {}, store: silo.store }),
		).rejects.toThrow(`already owned by environment "family-owner@1"`)
		scope[Symbol.dispose]()
		const memberScope = await memberEnvironment.activate({
			config: {},
			store: silo.store,
		})
		await expect(
			familyEnvironment.activate({ config: {}, store: silo.store }),
		).rejects.toThrow(`already owned by environment "member-owner@1"`)
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
			environment.activate({ config: {}, store: silo.store }),
		).rejects.toThrow(`already owned by environment "overlapping@1"`)
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
		}).activate({ config: {}, store: silo.store })
		await expect(
			environment(`partial`, {
				available: { role: `durable`, schema: z.number(), token: availableAtom },
				occupied: { role: `durable`, schema: z.number(), token: occupiedAtom },
			}).activate({ config: {}, store: silo.store }),
		).rejects.toThrow(`already owned`)
		const successor = await environment(`successor`, {
			available: { role: `durable`, schema: z.number(), token: availableAtom },
		}).activate({ config: {}, store: silo.store })
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
			invalid.activate({ config: { room: `` }, store: silo.store }),
		).rejects.toThrow(`config failed validation`)
		const valid = define(`valid`)
		const scope = await valid.activate({
			config: { room: `room` },
			store: silo.store,
		})
		await expect(
			valid.activate({ config: { room: `room` }, store: silo.store }),
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
		const scope = await environment.activate({ config: {}, store: silo.store })
		const imperativeAddress = scope.address as unknown as (
			member: string,
			...key: readonly Canonical[]
		) => unknown

		expect(() => imperativeAddress(`missing`)).toThrow(`Unknown`)
		expect(() => imperativeAddress(`blocks`)).toThrow(`requires a key`)
		expect(() => imperativeAddress(`body`, `extra`)).toThrow(
			`does not accept a key`,
		)
		await expect(scope.resolve(null)).rejects.toThrow(`must be an object`)
		await expect(scope.resolve(`address`)).rejects.toThrow(`must be an object`)
		await expect(
			scope.resolve({ environment: null, member: `body` }),
		).rejects.toThrow(`another environment`)
		await expect(
			scope.resolve({
				environment: { key: `addresses`, version: 2 },
				member: `body`,
			}),
		).rejects.toThrow(`another environment`)
		await expect(
			scope.resolve({
				environment: { key: `addresses`, version: 1 },
				member: 1,
			}),
		).rejects.toThrow(`unknown member`)
		await expect(
			scope.resolve({
				environment: { key: `addresses`, version: 1 },
				member: `toString`,
			}),
		).rejects.toThrow(`unknown member`)
		await expect(
			scope.resolve({
				environment: { key: `addresses`, version: 1 },
				key: `extra`,
				member: `body`,
			}),
		).rejects.toThrow(`does not accept a key`)
		await expect(scope.resolve(scope.address(`body`))).resolves.toEqual({
			member: scope.members.body,
			token: bodyAtom,
		})

		scope[Symbol.dispose]()
		scope[Symbol.dispose]()
		expect(() => scope.address(`body`)).toThrow(`disposed`)
		await expect(scope.resolve({})).rejects.toThrow(`disposed`)
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
