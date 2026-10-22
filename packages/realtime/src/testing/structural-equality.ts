/** Compare JSON-like values without depending on record property insertion order. */
export function structurallyEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true
	if (
		typeof left !== `object` ||
		left === null ||
		typeof right !== `object` ||
		right === null
	) {
		return false
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => structurallyEqual(value, right[index]))
		)
	}
	const leftRecord = left as Record<string, unknown>
	const rightRecord = right as Record<string, unknown>
	const leftKeys = Object.keys(leftRecord).sort()
	const rightKeys = Object.keys(rightRecord).sort()
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key, index) =>
				key === rightKeys[index] &&
				structurallyEqual(leftRecord[key], rightRecord[key]),
		)
	)
}
