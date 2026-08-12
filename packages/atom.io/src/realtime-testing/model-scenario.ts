import type { Json } from "atom.io/foundations/json"

/** A deterministic source used by model-based scenario generators. */
export class SeededScenarioRandom {
	#state: number
	public readonly seed: number

	public constructor(seed: number) {
		this.seed = seed
		this.#state = seed || 1
	}

	/** Return a floating-point value in [0, 1). */
	public next(): number {
		let value = this.#state | 0
		value ^= value << 13
		value ^= value >>> 17
		value ^= value << 5
		this.#state = value
		return (value >>> 0) / 0x1_0000_0000
	}

	/** Select an integer in [0, exclusiveMaximum). */
	public integer(exclusiveMaximum: number): number {
		if (!Number.isInteger(exclusiveMaximum) || exclusiveMaximum < 1) {
			throw new Error(`exclusiveMaximum must be a positive integer`)
		}
		return Math.floor(this.next() * exclusiveMaximum)
	}

	/** Select one item without modifying the supplied collection. */
	public pick<Value>(values: readonly Value[]): Value {
		if (values.length === 0) throw new Error(`Cannot pick from an empty array`)
		return values[this.integer(values.length)]
	}
}

export type ModelScenarioStep<Action, Fault> =
	| {
			readonly action: Action
			readonly clientId: string
			readonly type: `action`
	  }
	| { readonly fault: Fault; readonly type: `fault` }

/** Serializable input sufficient to reproduce a generated scenario. */
export type ModelScenarioSchedule<Action, Fault> = {
	readonly seed: number
	readonly steps: readonly ModelScenarioStep<Action, Fault>[]
	readonly version: 1
}

export type ModelScenarioGenerationContext = {
	readonly clientId: string
	readonly clientIds: readonly string[]
	readonly index: number
	readonly random: SeededScenarioRandom
}

export type ModelScenarioGenerationOptions<Action, Fault> = {
	/** Number of client actions. Defaults to 100 and is bounded by `maxSteps`. */
	actions?: number
	clientIds: readonly string[]
	/** Number of fault schedule changes. Defaults to zero. */
	faults?: number
	generateAction: (context: ModelScenarioGenerationContext) => Action
	generateFault?: (
		context: Omit<ModelScenarioGenerationContext, `clientId`>,
	) => Fault
	/** CI safety bound. Defaults to 1,000 clients. */
	maxClients?: number
	/** CI safety bound. Defaults to 10,000 total steps. */
	maxSteps?: number
	seed: number
}

/** Generate an interleaved, replayable action and network-fault schedule. */
export function generateModelScenario<Action, Fault = never>(
	options: ModelScenarioGenerationOptions<Action, Fault>,
): ModelScenarioSchedule<Action, Fault> {
	if (options.clientIds.length === 0) {
		throw new Error(`A model scenario requires at least one client`)
	}
	if (new Set(options.clientIds).size !== options.clientIds.length) {
		throw new Error(`Model scenario client IDs must be unique`)
	}
	const actions = options.actions ?? 100
	const faults = options.faults ?? 0
	const maxClients = options.maxClients ?? 1_000
	const maxSteps = options.maxSteps ?? 10_000
	for (const [label, value] of Object.entries({
		actions,
		faults,
		maxClients,
		maxSteps,
	})) {
		if (!Number.isInteger(value) || value < 0) {
			throw new Error(`${label} must be a non-negative integer`)
		}
	}
	if (options.clientIds.length > maxClients) {
		throw new Error(
			`Model scenario requested ${options.clientIds.length} clients, exceeding maxClients ${maxClients}`,
		)
	}
	if (actions + faults > maxSteps) {
		throw new Error(
			`Model scenario requested ${actions + faults} steps, exceeding maxSteps ${maxSteps}`,
		)
	}
	if (faults > 0 && options.generateFault === undefined) {
		throw new Error(`generateFault is required when faults is greater than zero`)
	}

	const random = new SeededScenarioRandom(options.seed)
	const kinds = [
		...Array.from({ length: actions }, () => `action` as const),
		...Array.from({ length: faults }, () => `fault` as const),
	]
	const steps: ModelScenarioStep<Action, Fault>[] = []
	while (kinds.length > 0) {
		const kind = kinds.splice(random.integer(kinds.length), 1)[0]
		const index = steps.length
		if (kind === `action`) {
			const clientId = random.pick(options.clientIds)
			steps.push({
				action: options.generateAction({
					clientId,
					clientIds: options.clientIds,
					index,
					random,
				}),
				clientId,
				type: `action`,
			})
		} else {
			steps.push({
				fault: options.generateFault!({
					clientIds: options.clientIds,
					index,
					random,
				}),
				type: `fault`,
			})
		}
	}
	const schedule = { seed: options.seed, steps, version: 1 as const }
	assertSerializableSchedule(schedule)
	return schedule
}

export type ModelScenarioCheckpoint = {
	/** -1 for the initial quiescent state, otherwise the last applied step. */
	readonly stepIndex: number
	readonly totalSteps: number
}

export type ModelScenarioRuntime<Action, Fault> = {
	applyAction: (clientId: string, action: Action) => void | Promise<void>
	applyFault?: (fault: Fault) => void | Promise<void>
	assertInvariants: (checkpoint: ModelScenarioCheckpoint) => void | Promise<void>
	dispose?: () => void | Promise<void>
	/** Drain the deterministic clock, transport and application work. */
	quiesce: () => void | Promise<void>
}

export type ModelScenarioRunOptions<Action, Fault> = {
	createRuntime: (
		schedule: ModelScenarioSchedule<Action, Fault>,
	) =>
		| ModelScenarioRuntime<Action, Fault>
		| Promise<ModelScenarioRuntime<Action, Fault>>
	schedule: ModelScenarioSchedule<Action, Fault>
}

/** Failure with a JSON replay payload and the precise failing checkpoint. */
export class ModelScenarioFailure<Action, Fault> extends Error {
	public readonly schedule: ModelScenarioSchedule<Action, Fault>
	public readonly stepIndex: number

	public constructor(
		message: string,
		schedule: ModelScenarioSchedule<Action, Fault>,
		stepIndex: number,
		options?: ErrorOptions,
	) {
		super(message, options)
		this.name = `ModelScenarioFailure`
		this.schedule = schedule
		this.stepIndex = stepIndex
	}

	/** JSON text suitable for a fixture, issue, or CI artifact. */
	public replay(): string {
		return JSON.stringify(this.schedule, null, 2)
	}
}

/** Replay one schedule and assert invariants at every quiescent point. */
export async function runModelScenario<Action, Fault>(
	options: ModelScenarioRunOptions<Action, Fault>,
): Promise<void> {
	assertSerializableSchedule(options.schedule)
	const runtime = await options.createRuntime(options.schedule)
	let stepIndex = -1
	try {
		await runtime.quiesce()
		await runtime.assertInvariants({
			stepIndex,
			totalSteps: options.schedule.steps.length,
		})
		for (const [index, step] of options.schedule.steps.entries()) {
			stepIndex = index
			if (step.type === `action`) {
				await runtime.applyAction(step.clientId, step.action)
			} else {
				if (runtime.applyFault === undefined) {
					throw new Error(
						`Scenario contains a fault but runtime.applyFault is absent`,
					)
				}
				await runtime.applyFault(step.fault)
			}
			await runtime.quiesce()
			await runtime.assertInvariants({
				stepIndex,
				totalSteps: options.schedule.steps.length,
			})
		}
	} catch (cause) {
		throw new ModelScenarioFailure(
			`Model scenario seed ${options.schedule.seed} failed after step ${stepIndex}`,
			options.schedule,
			stepIndex,
			{ cause },
		)
	} finally {
		await runtime.dispose?.()
	}
}

export type ModelScenarioShrinkOptions<Action, Fault> = {
	/** Return true only when the candidate reproduces the failure. */
	fails: (candidate: ModelScenarioSchedule<Action, Fault>) => Promise<boolean>
	/** Optional domain-specific smaller replacements for an individual step. */
	shrinkStep?: (
		step: ModelScenarioStep<Action, Fault>,
	) => Iterable<ModelScenarioStep<Action, Fault>>
}

/** Minimize a failing schedule using deterministic chunk removal and value shrinking. */
export async function shrinkModelScenario<Action, Fault>(
	schedule: ModelScenarioSchedule<Action, Fault>,
	options: ModelScenarioShrinkOptions<Action, Fault>,
): Promise<ModelScenarioSchedule<Action, Fault>> {
	let steps = [...schedule.steps]
	let granularity = 2
	while (steps.length > 0) {
		const chunkSize = Math.ceil(steps.length / granularity)
		let reduced = false
		for (let start = 0; start < steps.length; start += chunkSize) {
			const candidateSteps = [
				...steps.slice(0, start),
				...steps.slice(start + chunkSize),
			]
			const candidate = { ...schedule, steps: candidateSteps }
			if (await options.fails(candidate)) {
				steps = candidateSteps
				granularity = Math.max(2, granularity - 1)
				reduced = true
				break
			}
		}
		if (reduced) continue
		if (granularity >= steps.length) break
		granularity = Math.min(steps.length, granularity * 2)
	}

	if (options.shrinkStep !== undefined) {
		for (let index = 0; index < steps.length; index++) {
			for (const replacement of options.shrinkStep(steps[index])) {
				const candidateSteps = steps.with(index, replacement)
				const candidate = { ...schedule, steps: candidateSteps }
				if (await options.fails(candidate)) {
					steps = candidateSteps
					break
				}
			}
		}
	}
	return { ...schedule, steps }
}

export type SeededModelScenarioOptions<Action, Fault> =
	ModelScenarioGenerationOptions<Action, Fault> &
		Pick<ModelScenarioRunOptions<Action, Fault>, `createRuntime`> & {
			shrinkStep?: ModelScenarioShrinkOptions<Action, Fault>[`shrinkStep`]
		}

/** Generate, run and automatically minimize a reproducible scenario failure. */
export async function runSeededModelScenario<Action, Fault = never>(
	options: SeededModelScenarioOptions<Action, Fault>,
): Promise<ModelScenarioSchedule<Action, Fault>> {
	const schedule = generateModelScenario(options)
	try {
		await runModelScenario({ createRuntime: options.createRuntime, schedule })
		return schedule
	} catch (cause) {
		const minimized = await shrinkModelScenario(schedule, {
			fails: async (candidate) => {
				try {
					await runModelScenario({
						createRuntime: options.createRuntime,
						schedule: candidate,
					})
					return false
				} catch {
					return true
				}
			},
			...(options.shrinkStep === undefined
				? {}
				: { shrinkStep: options.shrinkStep }),
		})
		let minimizedFailure: unknown
		try {
			await runModelScenario({
				createRuntime: options.createRuntime,
				schedule: minimized,
			})
		} catch (error) {
			minimizedFailure = error
		}
		const stepIndex =
			minimizedFailure instanceof ModelScenarioFailure
				? minimizedFailure.stepIndex
				: -1
		throw new ModelScenarioFailure(
			`Model scenario seed ${schedule.seed} failed; minimized ${schedule.steps.length} steps to ${minimized.steps.length}`,
			minimized,
			stepIndex,
			{ cause },
		)
	}
}

function assertSerializableSchedule<Action, Fault>(
	schedule: ModelScenarioSchedule<Action, Fault>,
): void {
	try {
		assertJsonValue(schedule, new Set())
		JSON.parse(JSON.stringify(schedule)) as Json.Serializable
	} catch (cause) {
		throw new Error(`Model scenario schedule must be JSON-serializable`, {
			cause,
		})
	}
}

function assertJsonValue(value: unknown, ancestors: Set<object>): void {
	if (
		value === null ||
		typeof value === `string` ||
		typeof value === `boolean`
	) {
		return
	}
	if (typeof value === `number`) {
		if (!Number.isFinite(value)) throw new Error(`JSON numbers must be finite`)
		return
	}
	if (typeof value !== `object`) {
		throw new Error(`Unsupported JSON value: ${typeof value}`)
	}
	if (ancestors.has(value)) throw new Error(`Circular JSON value`)
	ancestors.add(value)
	if (Array.isArray(value)) {
		for (const item of value) assertJsonValue(item, ancestors)
	} else {
		const prototype = Object.getPrototypeOf(value) as unknown
		if (prototype !== Object.prototype && prototype !== null) {
			throw new Error(`JSON objects must be plain records`)
		}
		for (const item of Object.values(value)) assertJsonValue(item, ancestors)
	}
	ancestors.delete(value)
}
