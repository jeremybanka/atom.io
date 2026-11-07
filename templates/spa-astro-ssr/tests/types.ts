import { api, type Product } from "../src/api.ts"
import { readProduct } from "../src/server/inventory.ts"

const direct = readProduct(1)
const revision: number = direct.revision
const dto: Product = direct
const dtoRevision: number = dto.revision
const remote = await api.inventory.get.query({ id: 1 })
const remoteRevision: number = remote.revision
void [revision, dtoRevision, remoteRevision]
// @ts-expect-error IDs are numeric throughout the transport contract.
void api.inventory.get.query({ id: `one` })

// @ts-expect-error The inferred result does not invent columns absent from SQL.
void remote.missingColumn
// @ts-expect-error The shared server function also requires numeric IDs.
readProduct(`one`)

void api.inventory.setStock.mutate({ id: 1, stock: 12, revision: 1 })
// @ts-expect-error Stock counts are numeric.
void api.inventory.setStock.mutate({ id: 1, stock: `twelve`, revision: 1 })
