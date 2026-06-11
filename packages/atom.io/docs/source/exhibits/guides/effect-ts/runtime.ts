import { Config, Context, Effect, Layer, ManagedRuntime } from "effect"

export class ProfileService extends Context.Tag(`ProfileService`)<
	ProfileService,
	{
		readonly load: (userId: string) => Effect.Effect<Profile, ProfileError>
		readonly rename: (
			userId: string,
			name: string,
		) => Effect.Effect<Profile, ProfileError>
	}
>() {}

export class ProfileError extends Error {
	override name = `ProfileError`
}

export type Profile = {
	readonly id: string
	readonly name: string
	readonly plan: `free` | `pro`
}

const ProfileServiceLive = Layer.effect(
	ProfileService,
	Effect.gen(function* () {
		const apiOrigin = yield* Config.string(`API_ORIGIN`)

		return {
			load: (userId) =>
				Effect.tryPromise({
					try: () =>
						fetch(`${apiOrigin}/users/${userId}`).then(
							(response) => response.json() as Promise<Profile>,
						),
					catch: () => new ProfileError(`Unable to load profile`),
				}),
			rename: (userId, name) =>
				Effect.tryPromise({
					try: () =>
						fetch(`${apiOrigin}/users/${userId}`, {
							method: `PATCH`,
							body: JSON.stringify({ name }),
						}).then((response) => response.json() as Promise<Profile>),
					catch: () => new ProfileError(`Unable to rename profile`),
				}),
		}
	}),
)

export const appRuntime = ManagedRuntime.make(ProfileServiceLive)
