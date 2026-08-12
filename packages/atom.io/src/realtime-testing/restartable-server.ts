/** A value or a promise for that value. */
export type MaybePromise<T> = Promise<T> | T

/** Why a running test server was stopped. */
export type TestServerStopMode = `crash` | `graceful`

/** Whether a restart retains the server's durable fixture. */
export type TestServerDurability = `discard` | `preserve`

/** Lifecycle information supplied to restartable server hooks. */
export type RestartableServerContext<DurableState, EphemeralState> = {
	/** State that survives restarts unless it is explicitly discarded. */
	durable: DurableState
	/** State recreated for every server generation. */
	ephemeral: EphemeralState
	/** Starts at one and increases every time the server starts. */
	generation: number
	/** Stable name used to identify this fixture in diagnostics. */
	name: string
}

/** Hooks used to adapt an arbitrary server to the restartable test fixture. */
export type RestartableServerHooks<DurableState, EphemeralState, Runtime> = {
	/** Create a fresh durable fixture, initially and after a discarded restart. */
	createDurableState: () => MaybePromise<DurableState>
	/** Create generation-local state. This is called on every start. */
	createEphemeralState: (
		context: Pick<
			RestartableServerContext<DurableState, never>,
			`durable` | `generation` | `name`
		>,
	) => MaybePromise<EphemeralState>
	/** Start the adapted server and return its running interface. */
	start: (
		context: RestartableServerContext<DurableState, EphemeralState>,
	) => MaybePromise<Runtime>
	/** Gracefully stop a running server. */
	stop?: (
		runtime: Runtime,
		context: RestartableServerContext<DurableState, EphemeralState>,
	) => MaybePromise<void>
	/** Simulate abrupt termination without invoking graceful cleanup. */
	crash?: (
		runtime: Runtime,
		context: RestartableServerContext<DurableState, EphemeralState>,
	) => MaybePromise<void>
}

/** A lifecycle event emitted by a restartable server fixture. */
export type RestartableServerEvent = {
	generation: number
	name: string
	sequence: number
	type: `crashed` | `durable-discarded` | `started` | `stopped`
}

/** Options for {@link createRestartableServerFixture}. */
export type RestartableServerOptions<DurableState, EphemeralState, Runtime> =
	RestartableServerHooks<DurableState, EphemeralState, Runtime> & {
		name: string
		onEvent?: (event: RestartableServerEvent) => void
	}

/** Options accepted by {@link RestartableServerFixture.restart}. */
export type RestartServerOptions = {
	/** Defaults to a graceful stop. */
	mode?: TestServerStopMode
	/** Defaults to retaining durable state. */
	durability?: TestServerDurability
}

/** Lifecycle surface consumed by topology routers. */
export type RestartableServerController<Runtime> = {
	readonly generation: number
	readonly running: boolean
	crash: () => Promise<void>
	getRuntime: () => Runtime
	restart: (options?: RestartServerOptions) => Promise<Runtime>
	stop: () => Promise<void>
}

/**
 * A transport-independent server lifecycle fixture.
 *
 * Durable state belongs to the fixture; ephemeral state and the runtime belong
 * to one generation. This distinction makes restart tests state their
 * persistence assumptions directly.
 */
export class RestartableServerFixture<DurableState, EphemeralState, Runtime> {
	public readonly name: string

	#context: RestartableServerContext<DurableState, EphemeralState> | undefined
	#durable!: DurableState
	#generation = 0
	#hooks: RestartableServerHooks<DurableState, EphemeralState, Runtime>
	#initializing: Promise<void>
	#onEvent: ((event: RestartableServerEvent) => void) | undefined
	#runtime: Runtime | undefined
	#sequence = 0
	#status: `resetting` | `running` | `starting` | `stopped` | `stopping` =
		`stopped`

	public constructor(
		options: RestartableServerOptions<DurableState, EphemeralState, Runtime>,
	) {
		this.name = options.name
		this.#hooks = options
		this.#onEvent = options.onEvent
		this.#initializing = Promise.resolve(options.createDurableState()).then(
			(durable) => {
				this.#durable = durable
			},
		)
	}

	/** The generation number, starting at zero before the first start. */
	public get generation(): number {
		return this.#generation
	}

	/** Whether the adapted server currently has a running generation. */
	public get running(): boolean {
		return this.#status === `running`
	}

	/** Obtain the durable fixture, including while the server is stopped. */
	public async getDurableState(): Promise<DurableState> {
		await this.#initializing
		return this.#durable
	}

	/** Obtain the current generation's ephemeral state. */
	public getEphemeralState(): EphemeralState {
		if (this.#context === undefined) {
			throw new Error(`Server fixture "${this.name}" is not running`)
		}
		return this.#context.ephemeral
	}

	/** Obtain the current running interface. */
	public getRuntime(): Runtime {
		if (this.#status !== `running`) {
			throw new Error(`Server fixture "${this.name}" is not running`)
		}
		return this.#runtime as Runtime
	}

	/** Start a new generation. */
	public async start(): Promise<Runtime> {
		if (this.#status !== `stopped`) {
			throw new Error(`Server fixture "${this.name}" is already running`)
		}
		this.#status = `starting`

		try {
			await this.#initializing
			const generation = ++this.#generation
			const durable = this.#durable
			const ephemeral = await this.#hooks.createEphemeralState({
				durable,
				generation,
				name: this.name,
			})
			const context = { durable, ephemeral, generation, name: this.name }
			const runtime = await this.#hooks.start(context)
			this.#context = context
			this.#runtime = runtime
			this.#status = `running`
			this.#emit(`started`)
			return runtime
		} catch (error) {
			this.#status = `stopped`
			throw error
		}
	}

	/** Gracefully stop the current generation. */
	public async stop(): Promise<void> {
		const { context, runtime } = this.#requireRunning()
		this.#status = `stopping`
		try {
			await this.#hooks.stop?.(runtime, context)
		} finally {
			this.#runtime = undefined
			this.#context = undefined
			this.#status = `stopped`
			this.#emit(`stopped`)
		}
	}

	/** Abruptly terminate the current generation without graceful cleanup. */
	public async crash(): Promise<void> {
		const { context, runtime } = this.#requireRunning()
		this.#status = `stopping`
		try {
			await this.#hooks.crash?.(runtime, context)
		} finally {
			this.#runtime = undefined
			this.#context = undefined
			this.#status = `stopped`
			this.#emit(`crashed`)
		}
	}

	/** Stop or crash, optionally discard durable state, then start again. */
	public async restart(options: RestartServerOptions = {}): Promise<Runtime> {
		const { durability = `preserve`, mode = `graceful` } = options
		if (this.running) {
			if (mode === `crash`) await this.crash()
			else await this.stop()
		}
		if (durability === `discard`) await this.discardDurableState()
		return this.start()
	}

	/** Replace durable state with a fresh fixture while the server is stopped. */
	public async discardDurableState(): Promise<void> {
		if (this.#status !== `stopped`) {
			throw new Error(
				`Cannot discard durable state while server fixture "${this.name}" is running`,
			)
		}
		this.#status = `resetting`
		try {
			await this.#initializing
			this.#durable = await this.#hooks.createDurableState()
			this.#emit(`durable-discarded`)
		} finally {
			this.#status = `stopped`
		}
	}

	#emit(type: RestartableServerEvent[`type`]): void {
		this.#onEvent?.({
			generation: this.#generation,
			name: this.name,
			sequence: ++this.#sequence,
			type,
		})
	}

	#requireRunning(): {
		context: RestartableServerContext<DurableState, EphemeralState>
		runtime: Runtime
	} {
		if (this.#status !== `running` || this.#context === undefined) {
			throw new Error(`Server fixture "${this.name}" is not running`)
		}
		return { context: this.#context, runtime: this.#runtime as Runtime }
	}
}

/** Create a restartable server fixture for an arbitrary server adapter. */
export function createRestartableServerFixture<
	DurableState,
	EphemeralState,
	Runtime,
>(
	options: RestartableServerOptions<DurableState, EphemeralState, Runtime>,
): RestartableServerFixture<DurableState, EphemeralState, Runtime> {
	return new RestartableServerFixture(options)
}
