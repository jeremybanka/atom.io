import type {
	AtomFamilyToken,
	AtomToken,
	MutableAtomFamilyToken,
	MutableAtomToken,
	ReadableFamilyToken,
	ReadableToken,
	SelectorFamilyToken,
	SelectorToken,
	Silo,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { findInStore, IMPLICIT, type Store, withdraw } from "atom.io/internal"

import type { StandardSchemaV1 } from "./standard-schema.ts"

const REGISTRY_KEY = `atom.io/realtime/mosaic-domains`

type AnyAtom = AtomToken<any, any, any>
type AnyAtomFamily = AtomFamilyToken<any, any, any>
type AnyReadable = ReadableToken<any, any, any>
type AnyReadableFamily = ReadableFamilyToken<any, any, any>
type AnySelector = SelectorToken<any, any, any>
type AnySelectorFamily = SelectorFamilyToken<any, any, any>

export type MosaicDomainDefinitionIdentity<
	Key extends string = string,
	Version extends number = number,
> = {
	readonly key: Key
	readonly version: Version
}

export type MosaicDomainIdentity<
	Definition extends MosaicDomainDefinitionIdentity =
		MosaicDomainDefinitionIdentity,
	Instance extends string = string,
> = {
	readonly definition: Definition
	readonly instance: Instance
}

export type MosaicDomainMemberRole =
	| `derived`
	| `durable`
	| `ephemeral`
	| `local`

type MosaicDomainSingletonMember<
	Role extends MosaicDomainMemberRole,
	Token extends AnyReadable,
> = {
	readonly role: Role
	readonly token: Token
	readonly keySchema?: never
}

type MosaicDomainFamilyMember<
	Role extends MosaicDomainMemberRole,
	Token extends AnyReadableFamily,
	KeySchema extends StandardSchemaV1<any, Canonical> = StandardSchemaV1<
		any,
		Canonical
	>,
> = {
	readonly role: Role
	readonly token: Token
	readonly keySchema: KeySchema
}

type MosaicDomainValidatedMember = {
	readonly schema: StandardSchemaV1
}

export type MosaicDomainDurableMember = MosaicDomainValidatedMember &
	(
		| MosaicDomainSingletonMember<`durable`, AnyAtom>
		| MosaicDomainFamilyMember<`durable`, AnyAtomFamily>
	)

export type MosaicDomainEphemeralMember = MosaicDomainValidatedMember &
	(
		| MosaicDomainSingletonMember<`ephemeral`, AnyAtom>
		| MosaicDomainFamilyMember<`ephemeral`, AnyAtomFamily>
	)

export type MosaicDomainLocalMember =
	| MosaicDomainSingletonMember<`local`, AnyAtom>
	| MosaicDomainFamilyMember<`local`, AnyAtomFamily>

export type MosaicDomainDerivedMember =
	| MosaicDomainSingletonMember<`derived`, AnySelector>
	| MosaicDomainFamilyMember<`derived`, AnySelectorFamily>

export type MosaicDomainMember =
	| MosaicDomainDerivedMember
	| MosaicDomainDurableMember
	| MosaicDomainEphemeralMember
	| MosaicDomainLocalMember

export type MosaicDomainMembers = Readonly<Record<string, MosaicDomainMember>>

type TokenValue<Token> = Token extends
	| MutableAtomFamilyToken<infer Mutable, any>
	| MutableAtomToken<infer Mutable, any>
	? ReturnType<Mutable[`toJSON`]>
	: Token extends
				| ReadableFamilyToken<infer Value, any, any>
				| ReadableToken<infer Value, any, any>
		? Value
		: never

type CompatibleSchema<Schema, Output> =
	Schema extends StandardSchemaV1<any, infer Parsed>
		? Parsed extends Output
			? Schema
			: never
		: never

type ValidMosaicDomainMember<Member extends MosaicDomainMember> =
	Member[`token`] extends ReadableFamilyToken<any, infer Key, any>
		? Member & {
				readonly keySchema: CompatibleSchema<Member[`keySchema`], Key>
			} & (Member extends MosaicDomainValidatedMember
					? {
							readonly schema: CompatibleSchema<
								Member[`schema`],
								TokenValue<Member[`token`]>
							>
						}
					: unknown)
		: Member extends MosaicDomainValidatedMember
			? Member & {
					readonly schema: CompatibleSchema<
						Member[`schema`],
						TokenValue<Member[`token`]>
					>
				}
			: Member

type MemberKey<Member extends MosaicDomainMember> =
	Member[`token`] extends ReadableFamilyToken<any, infer Key, any> ? Key : never

type MemberValue<Member extends MosaicDomainMember> =
	Member extends MosaicDomainValidatedMember
		? StandardSchemaV1.InferOutput<Member[`schema`]>
		: never

type RemotelyAddressableMember =
	| MosaicDomainDurableMember
	| MosaicDomainEphemeralMember

type RemotelyAddressableMemberName<Members extends MosaicDomainMembers> = {
	[Name in keyof Members]: Members[Name] extends RemotelyAddressableMember
		? Name
		: never
}[keyof Members]

export type MosaicDomainMemberAddress<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
	Name extends string = string,
	Key extends Canonical = Canonical,
> = {
	readonly domain: Identity
	readonly member: Name
	readonly key?: Key
}

type ResolvedToken<Token> =
	Token extends AtomFamilyToken<infer Value, infer Key, infer Error>
		? AtomToken<Value, Key, Error>
		: Token extends SelectorFamilyToken<infer Value, infer Key, infer Error>
			? SelectorToken<Value, Key, Error>
			: Token

export type ParsedMosaicDomainMember<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
	Member extends RemotelyAddressableMember = RemotelyAddressableMember,
> = Member extends RemotelyAddressableMember
	? {
			readonly address: MosaicDomainMemberAddress<
				Identity,
				string,
				MemberKey<Member>
			>
			readonly member: Member
		}
	: never

export type AcquiredMosaicDomainMember<
	Member extends RemotelyAddressableMember = RemotelyAddressableMember,
> = Member extends RemotelyAddressableMember
	? {
			readonly member: Member
			readonly token: ResolvedToken<Member[`token`]>
		}
	: never

export type MosaicDomainDefinitionOptions<
	Key extends string,
	Version extends number,
	ConfigSchema extends StandardSchemaV1,
	Members extends MosaicDomainMembers,
> = {
	readonly configSchema: ConfigSchema
	readonly key: Key
	readonly members: Members & {
		readonly [Name in keyof Members]: ValidMosaicDomainMember<Members[Name]>
	}
	readonly version: Version
}

export type MosaicDomainActivationOptions<
	ConfigSchema,
	Instance extends string,
> = {
	readonly config: ConfigSchema extends StandardSchemaV1<infer Input, any>
		? Input
		: never
	readonly instance: Instance
	readonly store?: Silo[`store`]
}

export interface MosaicDomainInstance<
	Identity extends MosaicDomainIdentity,
	Config,
	Members extends MosaicDomainMembers,
> extends Disposable {
	readonly config: Config
	readonly definitionIdentity: Identity[`definition`]
	readonly identity: Identity
	readonly members: Members
	readonly store: Silo[`store`]
	readonly disposed: boolean
	address<Name extends Extract<RemotelyAddressableMemberName<Members>, string>>(
		member: Name,
		...key: MemberKey<Members[Name]> extends never
			? readonly []
			: readonly [key: MemberKey<Members[Name]>]
	): MosaicDomainMemberAddress<Identity, Name, MemberKey<Members[Name]>>
	parseAddress(
		address: unknown,
	): Promise<
		ParsedMosaicDomainMember<
			Identity,
			Extract<Members[keyof Members], RemotelyAddressableMember>
		>
	>
	acquire(
		parsed: ParsedMosaicDomainMember<
			Identity,
			Extract<Members[keyof Members], RemotelyAddressableMember>
		>,
	): Promise<
		AcquiredMosaicDomainMember<
			Extract<Members[keyof Members], RemotelyAddressableMember>
		>
	>
	validateValue<
		Name extends Extract<RemotelyAddressableMemberName<Members>, string>,
	>(
		member: Name,
		value: unknown,
	): Promise<MemberValue<Members[Name]>>
}

export type MosaicDomainDefinition<
	DefinitionIdentity extends MosaicDomainDefinitionIdentity,
	ConfigSchema extends StandardSchemaV1,
	Members extends MosaicDomainMembers,
> = {
	readonly configSchema: ConfigSchema
	readonly definitionIdentity: DefinitionIdentity
	readonly members: Members
	activate<const Instance extends string>(
		options: MosaicDomainActivationOptions<ConfigSchema, Instance>,
	): Promise<
		MosaicDomainInstance<
			MosaicDomainIdentity<DefinitionIdentity, Instance>,
			StandardSchemaV1.InferOutput<ConfigSchema>,
			Members
		>
	>
}

type DurableClaim = {
	readonly family: string | null
	readonly key: string
}

type ClaimOwner = {
	readonly domain: string
	readonly family: string | null
}

type ClaimIndex = {
	readonly byKey: Map<string, ClaimOwner>
	readonly families: Map<string, ClaimOwner>
	readonly membersByFamily: Map<string, Map<string, ClaimOwner>>
}

function emptyClaimIndex(): ClaimIndex {
	return {
		byKey: new Map(),
		families: new Map(),
		membersByFamily: new Map(),
	}
}

function findClaimConflict(
	index: ClaimIndex,
	claim: DurableClaim,
): ClaimOwner | undefined {
	const exact = index.byKey.get(claim.key)
	if (exact) return exact
	if (claim.family === null) return undefined
	const familyOwner = index.families.get(claim.family)
	if (familyOwner) return familyOwner
	if (claim.key === `family:${claim.family}`) {
		return index.membersByFamily.get(claim.family)?.values().next().value
	}
	return undefined
}

function addClaim(
	index: ClaimIndex,
	claim: DurableClaim,
	owner: ClaimOwner,
): void {
	index.byKey.set(claim.key, owner)
	if (claim.family === null) return
	if (claim.key === `family:${claim.family}`) {
		index.families.set(claim.family, owner)
		return
	}
	let members = index.membersByFamily.get(claim.family)
	if (!members) {
		members = new Map()
		index.membersByFamily.set(claim.family, members)
	}
	members.set(claim.key, owner)
}

function removeClaim(index: ClaimIndex, claim: DurableClaim): void {
	index.byKey.delete(claim.key)
	if (claim.family === null) return
	if (claim.key === `family:${claim.family}`) {
		index.families.delete(claim.family)
		return
	}
	const members = index.membersByFamily.get(claim.family)
	if (!members) return
	members.delete(claim.key)
	if (members.size === 0) index.membersByFamily.delete(claim.family)
}

class MosaicDomainRegistry implements Disposable {
	readonly #active = new Map<
		string,
		{
			readonly claims: readonly DurableClaim[]
			readonly instance: MosaicDomainInstance<any, any, any>
		}
	>()
	readonly #durable = emptyClaimIndex()
	#disposed = false

	public get disposed(): boolean {
		return this.#disposed
	}

	public claim(
		definition: string,
		domain: string,
		claims: readonly DurableClaim[],
		instance: MosaicDomainInstance<any, any, any>,
	): void {
		if (this.#active.has(definition)) {
			throw new Error(
				`Mosaic Domain definition "${definition}" is already active in this Store. Use a separate Store or Silo for another instance.`,
			)
		}
		const staged = emptyClaimIndex()
		const owner = { domain, family: null }
		for (const claim of claims) {
			const conflict =
				findClaimConflict(this.#durable, claim) ??
				findClaimConflict(staged, claim)
			if (conflict) {
				throw new Error(
					`Durable Mosaic Domain member "${claim.key}" is already owned by domain "${conflict.domain}" in this Store.`,
				)
			}
			addClaim(staged, claim, { ...owner, family: claim.family })
		}
		this.#active.set(definition, { claims, instance })
		for (const claim of claims) {
			addClaim(this.#durable, claim, { ...owner, family: claim.family })
		}
	}

	public release(definition: string): void {
		const active = this.#active.get(definition)
		if (!active) return
		this.#active.delete(definition)
		for (const claim of active.claims) removeClaim(this.#durable, claim)
	}

	public [Symbol.dispose](): void {
		if (this.#disposed) return
		this.#disposed = true
		for (const { instance } of [...this.#active.values()])
			instance[Symbol.dispose]()
		this.#active.clear()
		this.#durable.byKey.clear()
		this.#durable.families.clear()
		this.#durable.membersByFamily.clear()
	}
}

const registries = new WeakMap<Store, MosaicDomainRegistry>()

function registryFor(store: Store): MosaicDomainRegistry {
	const existing = registries.get(store)
	if (existing && !existing.disposed) return existing
	const registry = new MosaicDomainRegistry()
	registries.set(store, registry)
	store.miscResources.set(REGISTRY_KEY, registry)
	return registry
}

function definitionKey(identity: MosaicDomainDefinitionIdentity): string {
	return `${identity.key}@${identity.version}`
}

function domainKey(identity: MosaicDomainIdentity): string {
	return `${definitionKey(identity.definition)}#${identity.instance}`
}

function isFamily(
	token: AnyReadable | AnyReadableFamily,
): token is AnyReadableFamily {
	return token.type.endsWith(`_family`)
}

function claimsFor(members: MosaicDomainMembers): DurableClaim[] {
	const claims: DurableClaim[] = []
	for (const member of Object.values(members)) {
		if (member.role !== `durable`) continue
		if (isFamily(member.token)) {
			claims.push({
				family: member.token.key,
				key: `family:${member.token.key}`,
			})
		} else {
			claims.push({
				family: member.token.family?.key ?? null,
				key: `member:${member.token.key}`,
			})
		}
	}
	return claims
}

function assertMembership(members: MosaicDomainMembers): void {
	const tokens = new Map<string, string>()
	for (const [name, member] of Object.entries(members)) {
		if (name.length === 0)
			throw new Error(`Mosaic Domain member names cannot be empty.`)
		const family = isFamily(member.token)
		if (family !== `keySchema` in member) {
			throw new Error(
				`Mosaic Domain family member "${name}" must declare a keySchema; singleton members must not.`,
			)
		}
		const typeIsAtom =
			member.token.type === `atom` ||
			member.token.type === `mutable_atom` ||
			member.token.type === `atom_family` ||
			member.token.type === `mutable_atom_family`
		if (member.role === `derived` ? typeIsAtom : !typeIsAtom) {
			throw new Error(
				`Mosaic Domain member "${name}" has role "${member.role}", which is incompatible with token type "${member.token.type}".`,
			)
		}
		if (
			(member.role === `durable` || member.role === `ephemeral`) &&
			!(`schema` in member)
		) {
			throw new Error(
				`Mosaic Domain member "${name}" must declare a Standard Schema.`,
			)
		}
		const previous = tokens.get(member.token.key)
		if (previous) {
			throw new Error(
				`Mosaic Domain members "${previous}" and "${name}" refer to the same token "${member.token.key}".`,
			)
		}
		tokens.set(member.token.key, name)
	}
}

async function validate<Schema extends StandardSchemaV1>(
	schema: Schema,
	value: unknown,
	boundary: string,
): Promise<StandardSchemaV1.InferOutput<Schema>> {
	const result = await schema[`~standard`].validate(value)
	if (result.issues) {
		const reason = result.issues.map((issue) => issue.message).join(`; `)
		throw new Error(`${boundary} failed validation: ${reason}`)
	}
	return result.value
}

/**
 * Declare a Mosaic Domain over ordinary atom.io states.
 *
 * The returned definition owns no state. Activating it reserves durable members
 * in one Store and returns an identity-neutral, disposable instance for transport
 * layers. Synchronization controllers bind actors and sessions to that instance.
 */
export function mosaicDomain<
	const Key extends string,
	const Version extends number,
	ConfigSchema extends StandardSchemaV1,
	const Members extends MosaicDomainMembers,
>(
	options: MosaicDomainDefinitionOptions<Key, Version, ConfigSchema, Members>,
): MosaicDomainDefinition<
	MosaicDomainDefinitionIdentity<Key, Version>,
	ConfigSchema,
	Members
> {
	if (options.key.length === 0) {
		throw new Error(`A Mosaic Domain definition key cannot be empty.`)
	}
	if (!Number.isSafeInteger(options.version) || options.version < 1) {
		throw new Error(
			`A Mosaic Domain definition version must be a positive integer.`,
		)
	}
	assertMembership(options.members)
	const identity = Object.freeze({
		key: options.key,
		version: options.version,
	})
	const members = Object.freeze(
		Object.fromEntries(
			Object.entries(options.members).map(([name, member]) => [
				name,
				Object.freeze({ ...member }),
			]),
		) as unknown as Members,
	)

	return Object.freeze({
		configSchema: options.configSchema,
		definitionIdentity: identity,
		members,
		async activate({
			config: input,
			instance: instanceKey,
			store = IMPLICIT.STORE,
		}) {
			if (typeof instanceKey !== `string` || instanceKey.length === 0) {
				throw new Error(`A Mosaic Domain instance cannot be empty.`)
			}
			const config = await validate(
				options.configSchema,
				input,
				`Mosaic Domain "${definitionKey(identity)}#${instanceKey}" config`,
			)
			for (const member of Object.values(members)) {
				withdraw(store, member.token)
			}
			const registry = registryFor(store)
			const definition = definitionKey(identity)
			const instanceIdentity = Object.freeze({
				definition: identity,
				instance: instanceKey,
			})
			const domain = domainKey(instanceIdentity)
			let disposed = false
			const domainInstance: MosaicDomainInstance<
				typeof instanceIdentity,
				typeof config,
				Members
			> = {
				config,
				definitionIdentity: identity,
				identity: instanceIdentity,
				members,
				store,
				get disposed() {
					return disposed
				},
				address(member, ...memberKey) {
					if (disposed) throw new Error(`This Mosaic Domain is disposed.`)
					const memberDefinition = members[member]
					if (!memberDefinition) {
						throw new Error(`Unknown Mosaic Domain member "${member}".`)
					}
					if (
						memberDefinition.role === `local` ||
						memberDefinition.role === `derived`
					) {
						throw new Error(
							`Mosaic Domain member "${member}" is not remotely addressable.`,
						)
					}
					const family = isFamily(memberDefinition.token)
					if (family !== (memberKey.length === 1)) {
						throw new Error(
							family
								? `Mosaic Domain family member "${member}" requires a key.`
								: `Mosaic Domain singleton member "${member}" does not accept a key.`,
						)
					}
					return {
						domain: instanceIdentity,
						member,
						...(family ? { key: memberKey[0] } : {}),
					} as never
				},
				async parseAddress(address) {
					if (disposed) throw new Error(`This Mosaic Domain is disposed.`)
					if (typeof address !== `object` || address === null) {
						throw new Error(`A Mosaic Domain member address must be an object.`)
					}
					const candidate = address as Record<string, unknown>
					const addressDomain = candidate[`domain`]
					if (
						typeof addressDomain !== `object` ||
						addressDomain === null ||
						(addressDomain as Record<string, unknown>)[`instance`] !==
							instanceIdentity.instance
					) {
						throw new Error(
							`The Mosaic Domain member address belongs to another domain instance.`,
						)
					}
					const addressDefinition = (addressDomain as Record<string, unknown>)[
						`definition`
					]
					if (
						typeof addressDefinition !== `object` ||
						addressDefinition === null ||
						(addressDefinition as Record<string, unknown>)[`key`] !==
							identity.key ||
						(addressDefinition as Record<string, unknown>)[`version`] !==
							identity.version
					) {
						throw new Error(
							`The Mosaic Domain member address belongs to another domain definition.`,
						)
					}
					const name = candidate[`member`]
					if (typeof name !== `string` || !Object.hasOwn(members, name)) {
						throw new Error(
							`The Mosaic Domain member address has an unknown member.`,
						)
					}
					const member = members[name]
					if (member.role === `local` || member.role === `derived`) {
						throw new Error(
							`Mosaic Domain member "${name}" is not remotely addressable.`,
						)
					}
					if (isFamily(member.token)) {
						const parsedKey = await validate(
							member.keySchema!,
							candidate[`key`],
							`Mosaic Domain member "${name}" key`,
						)
						return {
							address: {
								domain: instanceIdentity,
								key: parsedKey,
								member: name,
							},
							member,
						} as never
					}
					if (`key` in candidate) {
						throw new Error(
							`Mosaic Domain singleton member "${name}" does not accept a key.`,
						)
					}
					return {
						address: { domain: instanceIdentity, member: name },
						member,
					} as never
				},
				async acquire(parsed) {
					if (disposed) throw new Error(`This Mosaic Domain is disposed.`)
					const checked = await domainInstance.parseAddress(parsed.address)
					if (isFamily(checked.member.token)) {
						const token = findInStore(
							store,
							checked.member.token,
							checked.address.key,
						)
						return { member: checked.member, token } as never
					}
					return { member: checked.member, token: checked.member.token } as never
				},
				validateValue(member, value) {
					if (disposed) {
						return Promise.reject(new Error(`This Mosaic Domain is disposed.`))
					}
					const memberDefinition = members[member]
					if (!memberDefinition || !(`schema` in memberDefinition)) {
						return Promise.reject(
							new Error(
								`Mosaic Domain member "${member}" does not accept remote values.`,
							),
						)
					}
					return validate(
						memberDefinition.schema,
						value,
						`Mosaic Domain member "${member}" value`,
					) as never
				},
				[Symbol.dispose]() {
					if (disposed) return
					disposed = true
					registry.release(definition)
				},
			}
			registry.claim(definition, domain, claimsFor(members), domainInstance)
			return domainInstance
		},
	})
}
