import {
	generateModelScenario,
	runModelScenario,
} from "atom.io/realtime-testing"

type Action = { amount: number; type: `increment` }
type Fault = `disconnect` | `duplicate-next` | `reorder-next-two`

const schedule = generateModelScenario<Action, Fault>({
	actions: 40,
	clientIds: [`ada`, `grace`, `linus`],
	faults: 8,
	generateAction: ({ random }) => ({
		amount: random.integer(3) + 1,
		type: `increment`,
	}),
	generateFault: ({ random }) =>
		random.pick([`disconnect`, `duplicate-next`, `reorder-next-two`]),
	seed: 0x21_25,
})

await runModelScenario({
	createRuntime: async () => createCounterRuntime(),
	schedule,
})

declare function createCounterRuntime(): Promise<{
	applyAction(clientId: string, action: Action): Promise<void>
	applyFault(fault: Fault): Promise<void>
	assertInvariants(): Promise<void>
	quiesce(): Promise<void>
}>
