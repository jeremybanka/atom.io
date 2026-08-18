import { Silo } from "atom.io"
import { mosaicDomain, type MosaicDomainValueModel } from "atom.io/realtime"
import {
	createMosaicDomainBatchClient,
	createMosaicDomainTransactionBridge,
} from "atom.io/realtime-client"
import type { MosaicDomainBatchConnection } from "atom.io/realtime-server"
import { z } from "zod"

const silo = new Silo({
	isProduction: false,
	lifespan: `immortal`,
	name: `design`,
})
const xAtom = silo.atom<number>({ default: 0, key: `x` })
const yAtom = silo.atom<number>({ default: 0, key: `y` })

const coordinateModel = {
	encodeTransaction({ newValue }) {
		return { type: `set` as const, value: newValue }
	},
	identity: { key: `coordinate-register`, version: 1 },
	kind: `value`,
	operationSchema: z.object({
		type: z.literal(`set`),
		value: z.number(),
	}),
	reduce: (_current, operation) => operation.value,
} satisfies MosaicDomainValueModel<number, { type: `set`; value: number }>

const design = mosaicDomain({
	configSchema: z.object({}),
	key: `design`,
	members: {
		x: {
			model: coordinateModel,
			role: `durable`,
			schema: z.number(),
			token: xAtom,
		},
		y: {
			model: coordinateModel,
			role: `durable`,
			schema: z.number(),
			token: yAtom,
		},
	},
	version: 1,
})

const moveSelectionTransaction = silo.transaction<
	(input: { readonly x: number; readonly y: number }) => void
>({
	do: ({ set }, point) => {
		set(xAtom, point.x)
		set(yAtom, point.y)
	},
	key: `moveSelection`,
})

declare const connection: MosaicDomainBatchConnection
const domain = await design.activate({
	config: {},
	instance: `poster`,
	store: silo.store,
})
const collaboration = createMosaicDomainBatchClient({
	actor: `ada`,
	domain,
	session: `tab-1`,
	transport: connection,
})
await collaboration.start()

const bridge = createMosaicDomainTransactionBridge({
	client: collaboration,
	domain,
	transactions: [moveSelectionTransaction],
})

silo.runTransaction(moveSelectionTransaction, `drag-42`)({ x: 120, y: 80 })
await bridge.flush()
