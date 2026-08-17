import { Silo } from "atom.io"
import { clearStore } from "atom.io/internal"
import {
	mosaicDomain,
	type MosaicDomainResidencyTransport,
	type MosaicDomainValueModel,
} from "atom.io/realtime"
import { createMosaicDomainResidencyClient } from "atom.io/realtime-client"
import {
	createMosaicDomainBatchServer,
	createMosaicDomainResidencyServer,
} from "atom.io/realtime-server"
import { z } from "zod"

const valueModel = {
	identity: { key: `resident-disposal`, version: 1 },
	kind: `value`,
	operationSchema: z.object({ type: z.literal(`set`), value: z.number() }),
	reduce: (_value, operation) => operation.value,
} satisfies MosaicDomainValueModel<number, { type: `set`; value: number }>

async function fixture(name: string) {
	const silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name })
	const valueAtoms = silo.atomFamily<number, string>({
		default: 0,
		key: `value`,
	})
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `mos12-disposal`,
		members: {
			values: {
				keySchema: z.string(),
				model: valueModel,
				role: `durable`,
				schema: z.number(),
				token: valueAtoms,
			},
		},
		version: 1,
	})
	const domain = await definition.activate({
		config: {},
		instance: `document`,
		store: silo.store,
	})
	return { domain, silo }
}

test(`Store disposal tears down residency resources without durable deletion`, async () => {
	const serverState = await fixture(`residency-server-store-disposal`)
	const clientState = await fixture(`residency-client-store-disposal`)
	const batches = createMosaicDomainBatchServer({ domain: serverState.domain })
	const server = createMosaicDomainResidencyServer({
		batches,
		domain: serverState.domain,
	})
	const cleaned: string[] = []
	const client = createMosaicDomainResidencyClient({
		actor: `alice`,
		cleanup: (address) => {
			cleaned.push(String(address.key))
		},
		domain: clientState.domain,
		session: `session-a`,
		transport: server.connect({ actor: `alice`, session: `session-a` }),
	})
	await client.acquire(clientState.domain.address(`values`, `resident`))
	expect(client.state.residentMemberCount).toBe(1)

	clearStore(clientState.silo.store)
	expect(client.state.residentMemberCount).toBe(0)
	for (let turn = 0; turn < 4; turn++) await Promise.resolve()
	expect(cleaned).toEqual([`resident`])
	await expect(client.reconnect()).rejects.toThrow(`disposed`)
})

test(`disposal finishes every cleanup boundary when one disposer throws`, async () => {
	const serverState = await fixture(`residency-server-adversarial-disposal`)
	const clientState = await fixture(`residency-client-adversarial-disposal`)
	const batches = createMosaicDomainBatchServer({ domain: serverState.domain })
	const server = createMosaicDomainResidencyServer({
		batches,
		domain: serverState.domain,
	})
	const connected = server.connect({ actor: `alice`, session: `session-a` })
	const boundaries: string[] = []
	const transport: MosaicDomainResidencyTransport<
		typeof clientState.domain.identity
	> = {
		dispose() {
			connected.dispose?.()
			boundaries.push(`transport`)
			throw new Error(`transport cleanup failed`)
		},
		hydrate: (requests) => connected.hydrate(requests),
		propose: (batch) => connected.propose(batch),
		async subscribe(requests, listener) {
			const stop = await connected.subscribe(requests, listener)
			return () => {
				stop()
				boundaries.push(`subscription`)
				throw new Error(`subscription cleanup failed`)
			}
		},
	}
	const client = createMosaicDomainResidencyClient({
		actor: `alice`,
		cleanup: () => {
			boundaries.push(`resident`)
			throw new Error(`resident cleanup failed`)
		},
		domain: clientState.domain,
		session: `session-a`,
		transport,
	})
	const lease = await client.acquire(
		clientState.domain.address(`values`, `resident`),
	)

	await expect(client.dispose()).rejects.toThrow(`did not complete cleanly`)
	expect(boundaries).toEqual([`subscription`, `transport`, `resident`])
	expect(lease.active).toBe(false)
	expect(client.state.residentMemberCount).toBe(0)
	await expect(client.reconnect()).rejects.toThrow(`disposed`)
})
