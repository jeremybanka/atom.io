import { api, type Draft } from "../src/api.ts"
import { readDraft } from "../src/server/drafts.ts"

const direct = readDraft(1)
const revision: string = direct.revision
const dto: Draft = direct
const dtoRevision: string = dto.revision
const remote = await api.drafts.get.query({ id: 1 })
const remoteRevision: string = remote.revision
void [revision, dtoRevision, remoteRevision]
// @ts-expect-error IDs are numeric throughout the transport contract.
void api.drafts.get.query({ id: `one` })

// @ts-expect-error The inferred result does not invent columns absent from SQL.
void remote.missingColumn
// @ts-expect-error The shared server function also requires numeric IDs.
readDraft(`one`)
