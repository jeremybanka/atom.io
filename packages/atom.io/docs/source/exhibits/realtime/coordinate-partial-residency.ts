import { atomFamily } from "atom.io"
import {
	mosaicDomain,
	type MosaicDomainResidencyTransport,
	type MosaicDomainValueModel,
} from "atom.io/realtime"
import { createMosaicDomainResidencyClient } from "atom.io/realtime-client"
import { z } from "zod"

const noteModel = {
	identity: { key: `note`, version: 1 },
	kind: `value`,
	operationSchema: z.object({ text: z.string(), type: z.literal(`replace`) }),
	reduce: (_note, operation) => operation.text,
} satisfies MosaicDomainValueModel<string, { text: string; type: `replace` }>

const noteAtoms = atomFamily<string, string>({ default: ``, key: `note` })
const notebook = mosaicDomain({
	configSchema: z.object({}),
	key: `notebook`,
	members: {
		notes: {
			keySchema: z.string(),
			model: noteModel,
			role: `durable`,
			schema: z.string(),
			token: noteAtoms,
		},
	},
	version: 1,
})
const domain = await notebook.activate({ config: {}, instance: `field-notes` })

declare const transport: MosaicDomainResidencyTransport<typeof domain.identity>
const collaboration = createMosaicDomainResidencyClient({
	actor: `ada`,
	domain,
	maxResidentMembers: 200,
	session: `tab-1`,
	transport,
})

const firstView = await collaboration.acquire(domain.address(`notes`, `note-1`))
const secondView = await collaboration.acquire(domain.address(`notes`, `note-1`))

await collaboration.submit({
	address: firstView.address,
	operation: { text: `Shared field notes`, type: `replace` },
})

firstView.release()
await collaboration.evict(secondView.address) // false: secondView still owns a lease
secondView.release()
await collaboration.evict(secondView.address) // true: cached Store state is evicted
