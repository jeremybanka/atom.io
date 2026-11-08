export function toBytes(value: string): Uint8Array {
	const encoder = new TextEncoder()
	return encoder.encode(value)
}
