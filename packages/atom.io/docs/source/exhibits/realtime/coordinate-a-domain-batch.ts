import { atom, atomFamily } from "atom.io"
import { mosaicDomain, type MosaicDomainValueModel } from "atom.io/realtime"
import { createMosaicDomainBatchClient } from "atom.io/realtime-client"
import type { MosaicDomainBatchConnection } from "atom.io/realtime-server"
import { z } from "zod"

type Node = { x: number; y: number }

const moveNode = {
	identity: { key: `node-register`, version: 1 },
	kind: `value`,
	operationSchema: z.object({ x: z.number(), y: z.number() }),
	reduce: (_node, operation) => operation,
} satisfies MosaicDomainValueModel<Node, Node>

const pathOrderAtom = atom<string[]>({ default: [], key: `pathOrder` })
const nodeAtoms = atomFamily<Node, string>({
	default: { x: 0, y: 0 },
	key: `node`,
})

const design = mosaicDomain({
	configSchema: z.object({}),
	key: `design`,
	members: {
		nodes: {
			keySchema: z.string(),
			model: moveNode,
			role: `durable`,
			schema: z.object({ x: z.number(), y: z.number() }),
			token: nodeAtoms,
		},
		pathOrder: {
			model: {
				identity: { key: `path-order`, version: 1 },
				kind: `value`,
				operationSchema: z.array(z.string()),
				reduce: (_current, next) => next,
			},
			role: `durable`,
			schema: z.array(z.string()),
			token: pathOrderAtom,
		},
	},
	version: 1,
})

declare const connection: MosaicDomainBatchConnection
const domain = await design.activate({ config: {}, instance: `poster` })
const collaboration = createMosaicDomainBatchClient({
	actor: `ada`,
	domain,
	session: `tab-1`,
	transport: connection,
})

await collaboration.start()
await collaboration.submit(
	[
		{
			address: domain.address(`pathOrder`),
			operation: [`path-1`],
		},
		{
			address: domain.address(`nodes`, `node-1`),
			operation: { x: 120, y: 80 },
		},
	],
	`create-path`,
)
