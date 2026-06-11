export type FamilyLimitStrategy = `block` | `evict_oldest`

export type FamilyLimitOptions = {
	/** The maximum number of members that may exist in the family at once. */
	maxMembers?: number
	/**
	 * What to do when a new member would exceed `maxMembers`.
	 *
	 * @default "block"
	 */
	whenFull?: FamilyLimitStrategy
}
