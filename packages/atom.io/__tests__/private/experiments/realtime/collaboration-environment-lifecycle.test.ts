import { Silo } from "atom.io"
import { clearStore } from "atom.io/internal"
import { collaborationEnvironment } from "atom.io/realtime"
import { z } from "zod"

test(`clearing a Store disposes its active collaboration scopes`, async () => {
	const silo = new Silo({
		isProduction: false,
		lifespan: `ephemeral`,
		name: `collaboration-disposal`,
	})
	const stateAtom = silo.atom<number>({ default: 0, key: `state` })
	const environment = collaborationEnvironment({
		configSchema: z.object({}),
		key: `disposal`,
		members: {
			state: { role: `durable`, schema: z.number(), token: stateAtom },
		},
		version: 1,
	})
	const scope = await environment.activate({
		config: {},
		instance: `disposal/one`,
		store: silo.store,
	})
	const registry = silo.store.miscResources.get(
		`atom.io/realtime/collaboration-environments`,
	)!

	clearStore(silo.store)
	registry[Symbol.dispose]()
	expect(scope.disposed).toBe(true)
	expect(() => scope.address(`state`)).toThrow(`disposed`)

	const nextStateAtom = silo.atom<number>({ default: 0, key: `nextState` })
	const nextEnvironment = collaborationEnvironment({
		configSchema: z.object({}),
		key: `next-disposal`,
		members: {
			state: { role: `durable`, schema: z.number(), token: nextStateAtom },
		},
		version: 1,
	})
	await expect(
		nextEnvironment.activate({
			config: {},
			instance: `next/one`,
			store: silo.store,
		}),
	).resolves.toBeDefined()
})
