import { encodeRealtimePayload } from "./realtime-command.ts"

export type RealtimeProtocolOffer = {
	readonly versions: readonly number[]
	readonly capabilities: readonly string[]
	readonly requiredCapabilities?: readonly string[]
	readonly models?: Readonly<Record<string, readonly number[]>>
}
export type RealtimeProtocolSelection = {
	readonly status: `accepted`
	readonly version: number
	readonly capabilities: readonly string[]
	readonly models: Readonly<Record<string, number>>
}
export type RealtimeProtocolResult =
	| RealtimeProtocolSelection
	| {
			readonly status: `rejected`
			readonly code:
				| `invalid-offer`
				| `incompatible-version`
				| `missing-capability`
				| `incompatible-model`
			readonly reason: string
			readonly retryable: false
	  }

export function isRealtimeProtocolOffer(
	input: unknown,
): input is RealtimeProtocolOffer {
	if (
		encodeRealtimePayload(input, 16_384, 8) === null ||
		typeof input !== `object` ||
		input === null
	)
		return false
	const offer = input as RealtimeProtocolOffer
	const versions = (value: unknown): value is number[] =>
		Array.isArray(value) &&
		value.length > 0 &&
		value.length <= 32 &&
		value.every((version) => Number.isSafeInteger(version) && version > 0)
	const capabilities = (value: unknown): value is string[] =>
		Array.isArray(value) &&
		value.length <= 64 &&
		value.every(
			(name) =>
				typeof name === `string` && name.length > 0 && name.length <= 128,
		)
	return (
		versions(offer.versions) &&
		capabilities(offer.capabilities) &&
		(offer.requiredCapabilities === undefined ||
			capabilities(offer.requiredCapabilities)) &&
		(offer.models === undefined ||
			(typeof offer.models === `object` &&
				offer.models !== null &&
				!Array.isArray(offer.models) &&
				Object.entries(offer.models).length <= 64 &&
				Object.entries(offer.models).every(
					([name, values]) =>
						name.length > 0 && name.length <= 128 && versions(values),
				)))
	)
}

/** Deterministic highest-common-version selection. Every advertised model is required on both peers. */
export function negotiateRealtimeProtocol(
	local: RealtimeProtocolOffer,
	remote: unknown,
): RealtimeProtocolResult {
	const reject = (
		code: Extract<RealtimeProtocolResult, { status: `rejected` }>[`code`],
		reason: string,
	): RealtimeProtocolResult => ({
		status: `rejected`,
		code,
		reason,
		retryable: false,
	})
	if (!isRealtimeProtocolOffer(local) || !isRealtimeProtocolOffer(remote))
		return reject(`invalid-offer`, `Invalid protocol offer.`)
	const version = Math.max(
		...local.versions.filter((value) => remote.versions.includes(value)),
	)
	if (!Number.isFinite(version))
		return reject(`incompatible-version`, `No compatible protocol version.`)
	const capabilities = [
		...new Set(
			local.capabilities.filter((value) => remote.capabilities.includes(value)),
		),
	].sort()
	if (
		[
			...(local.requiredCapabilities ?? []),
			...(remote.requiredCapabilities ?? []),
		].some((value) => !capabilities.includes(value))
	) {
		return reject(
			`missing-capability`,
			`A required protocol capability is unavailable.`,
		)
	}
	const models: Record<string, number> = Object.create(null)
	for (const name of new Set([
		...Object.keys(local.models ?? {}),
		...Object.keys(remote.models ?? {}),
	])) {
		const localVersions =
			local.models && Object.hasOwn(local.models, name) ? local.models[name] : []
		const remoteVersions =
			remote.models && Object.hasOwn(remote.models, name)
				? remote.models[name]
				: []
		const selected = Math.max(
			...localVersions.filter((value) => remoteVersions.includes(value)),
		)
		if (!Number.isFinite(selected))
			return reject(
				`incompatible-model`,
				`A required replicated model is incompatible.`,
			)
		models[name] = selected
	}
	return Object.freeze({
		status: `accepted`,
		version,
		capabilities: Object.freeze(capabilities),
		models: Object.freeze(models),
	})
}
