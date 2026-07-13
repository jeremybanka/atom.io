import type { ChildStore } from "./is-root-store.ts"

export function abortTransaction(target: ChildStore): void {
	target.parent.child = null
	target.logger.info(
		`🪂`,
		`transaction`,
		target.transactionMeta.update.token.key,
		`Aborting transaction`,
	)
}
