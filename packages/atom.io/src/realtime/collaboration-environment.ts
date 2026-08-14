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

const REGISTRY_KEY = `atom.io/realtime/collaboration-environments`

type AnyAtom = AtomToken<any, any, any>
type AnyAtomFamily = AtomFamilyToken<any, any, any>
type AnyReadable = ReadableToken<any, any, any>
type AnyReadableFamily = ReadableFamilyToken<any, any, any>
type AnySelector = SelectorToken<any, any, any>
type AnySelectorFamily = SelectorFamilyToken<any, any, any>

export type CollaborationEnvironmentIdentity<
	Key extends string = string,
	Version extends number = number,
> = {
	readonly key: Key
	readonly version: Version
}

export type CollaborationMemberRole =
	| `derived`
	| `durable`
	| `ephemeral`
	| `local`

type CollaborationSingletonMember<
	Role extends CollaborationMemberRole,
	Token extends AnyReadable,
> = {
	readonly role: Role
	readonly token: Token
	readonly keySchema?: never
}

type CollaborationFamilyMember<
	Role extends CollaborationMemberRole,
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

type CollaborationValidatedMember = {
	readonly schema: StandardSchemaV1
}

export type CollaborationDurableMember = CollaborationValidatedMember &
	(
		| CollaborationSingletonMember<`durable`, AnyAtom>
		| CollaborationFamilyMember<`durable`, AnyAtomFamily>
	)

export type CollaborationEphemeralMember = CollaborationValidatedMember &
	(
		| CollaborationSingletonMember<`ephemeral`, AnyAtom>
		| CollaborationFamilyMember<`ephemeral`, AnyAtomFamily>
	)

export type CollaborationLocalMember =
	| CollaborationSingletonMember<`local`, AnyAtom>
	| CollaborationFamilyMember<`local`, AnyAtomFamily>

export type CollaborationDerivedMember =
	| CollaborationSingletonMember<`derived`, AnySelector>
	| CollaborationFamilyMember<`derived`, AnySelectorFamily>

export type CollaborationMember =
	| CollaborationDerivedMember
	| CollaborationDurableMember
	| CollaborationEphemeralMember
	| CollaborationLocalMember

export type CollaborationMembership = Readonly<
	Record<string, CollaborationMember>
>

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

type ValidCollaborationMember<Member extends CollaborationMember> =
	Member[`token`] extends ReadableFamilyToken<any, infer Key, any>
		? Member & {
				readonly keySchema: CompatibleSchema<Member[`keySchema`], Key>
			} & (Member extends CollaborationValidatedMember
					? {
							readonly schema: CompatibleSchema<
								Member[`schema`],
								TokenValue<Member[`token`]>
							>
						}
					: unknown)
		: Member extends CollaborationValidatedMember
			? Member & {
					readonly schema: CompatibleSchema<
						Member[`schema`],
						TokenValue<Member[`token`]>
					>
				}
			: Member

type MemberKey<Member extends CollaborationMember> =
	Member[`token`] extends ReadableFamilyToken<any, infer Key, any> ? Key : never

type MemberValue<Member extends CollaborationMember> =
	Member extends CollaborationValidatedMember
		? StandardSchemaV1.InferOutput<Member[`schema`]>
		: never

export type CollaborationMemberAddress<
	Identity extends CollaborationEnvironmentIdentity =
		CollaborationEnvironmentIdentity,
	Name extends string = string,
	Key extends Canonical = Canonical,
> = {
	readonly environment: Identity
	readonly member: Name
	readonly key?: Key
}

type ResolvedToken<Token> =
	Token extends AtomFamilyToken<infer Value, infer Key, infer Error>
		? AtomToken<Value, Key, Error>
		: Token extends SelectorFamilyToken<infer Value, infer Key, infer Error>
			? SelectorToken<Value, Key, Error>
			: Token

export type ResolvedCollaborationMember<
	Member extends CollaborationMember = CollaborationMember,
> = Member extends CollaborationMember
	? {
			readonly member: Member
			readonly token: ResolvedToken<Member[`token`]>
		}
	: never

export type CollaborationEnvironmentOptions<
	Key extends string,
	Version extends number,
	ConfigSchema extends StandardSchemaV1,
	Members extends CollaborationMembership,
> = {
	readonly configSchema: ConfigSchema
	readonly key: Key
	readonly members: Members & {
		readonly [Name in keyof Members]: ValidCollaborationMember<Members[Name]>
	}
	readonly version: Version
}

export type ActivateCollaborationEnvironmentOptions<ConfigSchema> = {
	readonly config: ConfigSchema extends StandardSchemaV1<infer Input, any>
		? Input
		: never
	readonly store?: Silo[`store`]
}

export interface CollaborationEnvironmentScope<
	Identity extends CollaborationEnvironmentIdentity,
	Config,
	Members extends CollaborationMembership,
> extends Disposable {
	readonly config: Config
	readonly identity: Identity
	readonly members: Members
	readonly store: Silo[`store`]
	readonly disposed: boolean
	address<Name extends Extract<keyof Members, string>>(
		member: Name,
		...key: MemberKey<Members[Name]> extends never
			? readonly []
			: readonly [key: MemberKey<Members[Name]>]
	): CollaborationMemberAddress<Identity, Name, MemberKey<Members[Name]>>
	resolve(
		address: unknown,
	): Promise<ResolvedCollaborationMember<Members[keyof Members]>>
	validateValue<Name extends Extract<keyof Members, string>>(
		member: Name,
		value: unknown,
	): Promise<MemberValue<Members[Name]>>
}

export type CollaborationEnvironmentDefinition<
	Identity extends CollaborationEnvironmentIdentity,
	ConfigSchema extends StandardSchemaV1,
	Members extends CollaborationMembership,
> = {
	readonly configSchema: ConfigSchema
	readonly identity: Identity
	readonly members: Members
	activate(
		options: ActivateCollaborationEnvironmentOptions<ConfigSchema>,
	): Promise<
		CollaborationEnvironmentScope<
			Identity,
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
	readonly environment: string
	readonly family: string | null
}

class CollaborationEnvironmentRegistry implements Disposable {
	readonly #active = new Map<
		string,
		CollaborationEnvironmentScope<any, any, any>
	>()
	readonly #durable = new Map<string, ClaimOwner>()
	#disposed = false

	public get disposed(): boolean {
		return this.#disposed
	}

	public claim(
		environment: string,
		claims: readonly DurableClaim[],
		scope: CollaborationEnvironmentScope<any, any, any>,
	): void {
		if (this.#active.has(environment)) {
			throw new Error(
				`Collaboration environment "${environment}" is already active in this Store.`,
			)
		}
		const prospective = new Map(this.#durable)
		for (const claim of claims) {
			for (const [ownedKey, owner] of prospective) {
				const overlaps =
					ownedKey === claim.key ||
					(claim.family !== null && ownedKey === `family:${claim.family}`) ||
					(owner.family !== null && claim.key === `family:${owner.family}`)
				if (overlaps) {
					throw new Error(
						`Durable collaboration member "${claim.key}" is already owned by environment "${owner.environment}" in this Store.`,
					)
				}
			}
			prospective.set(claim.key, {
				environment,
				family: claim.family,
			})
		}
		this.#active.set(environment, scope)
		for (const claim of claims) {
			this.#durable.set(claim.key, {
				environment,
				family: claim.family,
			})
		}
	}

	public release(environment: string): void {
		this.#active.delete(environment)
		for (const [key, owner] of this.#durable) {
			if (owner.environment === environment) this.#durable.delete(key)
		}
	}

	public [Symbol.dispose](): void {
		if (this.#disposed) return
		this.#disposed = true
		for (const scope of [...this.#active.values()]) scope[Symbol.dispose]()
		this.#active.clear()
		this.#durable.clear()
	}
}

const registries = new WeakMap<Store, CollaborationEnvironmentRegistry>()

function registryFor(store: Store): CollaborationEnvironmentRegistry {
	const existing = registries.get(store)
	if (existing && !existing.disposed) return existing
	const registry = new CollaborationEnvironmentRegistry()
	registries.set(store, registry)
	store.miscResources.set(REGISTRY_KEY, registry)
	return registry
}

function environmentKey(identity: CollaborationEnvironmentIdentity): string {
	return `${identity.key}@${identity.version}`
}

function isFamily(
	token: AnyReadable | AnyReadableFamily,
): token is AnyReadableFamily {
	return token.type.endsWith(`_family`)
}

function claimsFor(members: CollaborationMembership): DurableClaim[] {
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

function assertMembership(members: CollaborationMembership): void {
	const tokens = new Map<string, string>()
	for (const [name, member] of Object.entries(members)) {
		if (name.length === 0)
			throw new Error(`Collaboration member names cannot be empty.`)
		const family = isFamily(member.token)
		if (family !== `keySchema` in member) {
			throw new Error(
				`Collaboration family member "${name}" must declare a keySchema; singleton members must not.`,
			)
		}
		const typeIsAtom =
			member.token.type === `atom` ||
			member.token.type === `mutable_atom` ||
			member.token.type === `atom_family` ||
			member.token.type === `mutable_atom_family`
		if (member.role === `derived` ? typeIsAtom : !typeIsAtom) {
			throw new Error(
				`Collaboration member "${name}" has role "${member.role}", which is incompatible with token type "${member.token.type}".`,
			)
		}
		if (
			(member.role === `durable` || member.role === `ephemeral`) &&
			!(`schema` in member)
		) {
			throw new Error(
				`Collaboration member "${name}" must declare a Standard Schema.`,
			)
		}
		const previous = tokens.get(member.token.key)
		if (previous) {
			throw new Error(
				`Collaboration members "${previous}" and "${name}" refer to the same token "${member.token.key}".`,
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
	return result.value as StandardSchemaV1.InferOutput<Schema>
}

/**
 * Declare a coordination boundary over ordinary atom.io states.
 *
 * The returned definition owns no state. Activating it reserves durable members
 * in one Store and returns a disposable, Store-owned scope for transport layers.
 */
export function collaborationEnvironment<
	const Key extends string,
	const Version extends number,
	ConfigSchema extends StandardSchemaV1,
	const Members extends CollaborationMembership,
>(
	options: CollaborationEnvironmentOptions<Key, Version, ConfigSchema, Members>,
): CollaborationEnvironmentDefinition<
	CollaborationEnvironmentIdentity<Key, Version>,
	ConfigSchema,
	Members
> {
	if (options.key.length === 0) {
		throw new Error(`A collaboration environment key cannot be empty.`)
	}
	if (!Number.isSafeInteger(options.version) || options.version < 1) {
		throw new Error(
			`A collaboration environment version must be a positive integer.`,
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
		identity,
		members,
		async activate({ config: input, store = IMPLICIT.STORE }) {
			const config = await validate(
				options.configSchema,
				input,
				`Collaboration environment "${environmentKey(identity)}" config`,
			)
			for (const member of Object.values(members)) {
				withdraw(store, member.token)
			}
			const registry = registryFor(store)
			const key = environmentKey(identity)
			let disposed = false
			const scope: CollaborationEnvironmentScope<
				typeof identity,
				typeof config,
				Members
			> = {
				config,
				identity,
				members,
				store,
				get disposed() {
					return disposed
				},
				address(member, ...memberKey) {
					if (disposed)
						throw new Error(`This collaboration environment is disposed.`)
					const definition = members[member]
					if (!definition) {
						throw new Error(`Unknown collaboration member "${member}".`)
					}
					const family = isFamily(definition.token)
					if (family !== (memberKey.length === 1)) {
						throw new Error(
							family
								? `Collaboration family member "${member}" requires a key.`
								: `Collaboration singleton member "${member}" does not accept a key.`,
						)
					}
					return {
						environment: identity,
						member,
						...(family ? { key: memberKey[0] } : {}),
					} as never
				},
				async resolve(address) {
					if (disposed)
						throw new Error(`This collaboration environment is disposed.`)
					if (typeof address !== `object` || address === null) {
						throw new Error(`A collaboration member address must be an object.`)
					}
					const candidate = address as Record<string, unknown>
					const addressEnvironment = candidate[`environment`]
					if (
						typeof addressEnvironment !== `object` ||
						addressEnvironment === null ||
						(addressEnvironment as Record<string, unknown>)[`key`] !==
							identity.key ||
						(addressEnvironment as Record<string, unknown>)[`version`] !==
							identity.version
					) {
						throw new Error(
							`The collaboration member address belongs to another environment.`,
						)
					}
					const name = candidate[`member`]
					if (typeof name !== `string` || !Object.hasOwn(members, name)) {
						throw new Error(
							`The collaboration member address has an unknown member.`,
						)
					}
					const member = members[name]
					if (isFamily(member.token)) {
						const parsedKey = await validate(
							member.keySchema!,
							candidate[`key`],
							`Collaboration member "${name}" key`,
						)
						const token = findInStore(store, member.token, parsedKey)
						return { member, token } as never
					}
					if (`key` in candidate) {
						throw new Error(
							`Collaboration singleton member "${name}" does not accept a key.`,
						)
					}
					return { member, token: member.token } as never
				},
				async validateValue(member, value) {
					if (disposed)
						throw new Error(`This collaboration environment is disposed.`)
					const definition = members[member]
					if (!definition || !(`schema` in definition)) {
						throw new Error(
							`Collaboration member "${member}" does not accept remote values.`,
						)
					}
					return validate(
						definition.schema,
						value,
						`Collaboration member "${member}" value`,
					) as never
				},
				[Symbol.dispose]() {
					if (disposed) return
					disposed = true
					registry.release(key)
				},
			}
			registry.claim(key, claimsFor(members), scope)
			return scope
		},
	})
}
