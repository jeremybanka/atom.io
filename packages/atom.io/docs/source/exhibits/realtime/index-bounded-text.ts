import { atom, atomFamily } from "atom.io"
import {
	createMosaicTextIndex,
	createMosaicTextIndexReader,
	mosaicDomain,
	type MosaicTextIndexMember,
	MosaicTextIndexRangeRecoveryError,
	type MosaicTextIndexRoot,
} from "atom.io/realtime"
import {
	createMosaicDomainResidencyServer,
	type MosaicDomainBatchServer,
} from "atom.io/realtime-server"
import { z } from "zod"

type StoredIndexMember = { readonly value: MosaicTextIndexMember }

const emptyIndex = createMosaicTextIndex([])
const indexRootAtom = atom<MosaicTextIndexRoot>({
	default: emptyIndex.root,
	key: `indexRoot`,
})
const indexMemberAtoms = atomFamily<StoredIndexMember, string>({
	default: {
		value: {
			generation: 0,
			id: `alias:uninitialized`,
			kind: `alias`,
			source: `uninitialized`,
			targets: [],
			version: 1,
		},
	},
	key: `indexMember`,
})

const documentDefinition = mosaicDomain({
	configSchema: z.object({}),
	key: `indexed-document`,
	members: {
		indexMembers: {
			keySchema: z.string().min(1),
			role: `durable`,
			schema: z.object({ value: z.custom<MosaicTextIndexMember>() }),
			token: indexMemberAtoms,
		},
		indexRoot: {
			role: `durable`,
			schema: z.custom<typeof emptyIndex.root>(),
			token: indexRootAtom,
		},
	},
	version: 1,
})
const domain = await documentDefinition.activate({
	config: {},
	instance: `handbook`,
})

const textRangeSchema = z.object({
	end: z.number().int().nonnegative(),
	kind: z.literal(`utf16-range`),
	start: z.number().int().nonnegative(),
})

// A production implementation reads these bounded objects from the MOS-13
// checkpoint graph. The resolver never constructs unloaded client atoms.
declare const loadIndexMember: (
	id: string,
) => Promise<MosaicTextIndexMember | undefined>
declare const loadIndexRoot: () => Promise<MosaicTextIndexRoot>
declare const batches: MosaicDomainBatchServer

const residency = createMosaicDomainResidencyServer({
	batches,
	domain,
	range: {
		resolve: async ({ domain: activeDomain, limit, member, range }) => {
			if (member !== `indexMembers`) return []
			const reader = createMosaicTextIndexReader({
				read: loadIndexMember,
				root: loadIndexRoot,
			})
			const result = await reader.resolveRange(range, limit)
			if (result.status === `resnapshot`) {
				throw new MosaicTextIndexRangeRecoveryError(result.recovery)
			}
			return result.leafIds.map((id) => activeDomain.address(`indexMembers`, id))
		},
		schema: textRangeSchema,
	},
})

void residency
