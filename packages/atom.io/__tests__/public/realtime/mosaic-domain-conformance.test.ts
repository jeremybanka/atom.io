import type {
	MosaicDomainIdentity,
	MosaicDomainMemberAddress,
} from "atom.io/realtime"
import {
	MOSAIC_DOMAIN_CONFORMANCE_FAULT_SCHEDULE,
	type MosaicDomainConformanceAdapter,
	type MosaicDomainConformanceFault,
	testMosaicDomainConformance,
} from "atom.io/realtime-testing"

const identity: MosaicDomainIdentity = {
	definition: { key: `conformance`, version: 1 },
	instance: `document`,
}
const address = (key: string): MosaicDomainMemberAddress => ({
	domain: identity,
	key,
	member: `content`,
})
const firstAddress = address(`first`)
const secondAddress = address(`second`)

const validAdapter = (
	overrides: Partial<MosaicDomainConformanceAdapter> = {},
): MosaicDomainConformanceAdapter => {
	let instrumentationCalls = 0
	return {
		exerciseAtomicBatch: () =>
			Promise.resolve({
				affectedMembers: [firstAddress],
				logicalOperationCount: 2,
				revisionAfter: 2,
				revisionBefore: 1,
				selectorIntermediateValues: [],
				selectorSettlements: 1,
			}),
		exerciseFault: (fault: MosaicDomainConformanceFault) =>
			Promise.resolve({
				accepted: fault !== `reject`,
				authoritativeProjection: fault === `reject` ? 7 : 8,
				clientProjections: fault === `reject` ? [7, 7] : [8, 8],
				fault,
				faultSignals: 1,
				projectionBefore: 7,
			}),
		exerciseHistory: () =>
			Promise.resolve({
				baselineForeignProjection: 0,
				baselineOwnProjection: 0,
				foreignProjectionAfterForeignGesture: 2,
				foreignProjectionAfterRedo: 2,
				foreignProjectionAfterUndo: 2,
				ownProjectionAfterGesture: 1,
				ownProjectionAfterRedo: 1,
				ownProjectionAfterUndo: 0,
			}),
		exercisePresence: () =>
			Promise.resolve({
				departedActor: `ada`,
				durableProjectionAfterCleanup: { content: `stable` },
				durableProjectionBeforePresence: { content: `stable` },
				visibleActorsAfterCleanup: [`grace`],
				visibleActorsBeforeCleanup: [`ada`, `grace`],
			}),
		exerciseResidency: () =>
			Promise.resolve({
				eagerComplete: false,
				firstResidentAddresses: [firstAddress],
				secondResidentAddresses: [secondAddress],
				totalMemberCount: 3,
			}),
		foundation: () =>
			Promise.resolve({
				addresses: [firstAddress, secondAddress],
				identity,
				ownership: {
					atomFamily: true,
					headlessStore: true,
					rendererProjection: true,
					selector: true,
					transaction: true,
				},
			}),
		instrumentation: () => {
			instrumentationCalls++
			const value = instrumentationCalls === 1 ? 0 : 1
			return Promise.resolve({
				checkpointWrites: value,
				deliveredPayloads: value,
				residentMembers: value,
				retainedHistory: value,
				selectorInvalidations: value,
			})
		},
		name: `representative`,
		[Symbol.dispose]() {},
		...overrides,
	}
}

describe(`cross-vertical Mosaic Domain conformance runner`, () => {
	test(`owns one stable fault schedule and returns deterministic counters`, async () => {
		const report = await testMosaicDomainConformance(validAdapter())
		expect(report).toEqual({
			counters: {
				checkpointWrites: 1,
				deliveredPayloads: 1,
				residentMembers: 1,
				retainedHistory: 1,
				selectorInvalidations: 1,
			},
			domain: `conformance@1#document`,
			name: `representative`,
			schedule: MOSAIC_DOMAIN_CONFORMANCE_FAULT_SCHEDULE,
		})
		expect(Object.isFrozen(report)).toBe(true)
		expect(Object.isFrozen(report.counters)).toBe(true)
	})

	test.each([
		[
			`empty adapter name`,
			() => validAdapter({ name: `` }),
			`adapter names cannot be empty`,
		],
		[
			`lost Store ownership`,
			() =>
				validAdapter({
					foundation: () =>
						Promise.resolve({
							addresses: [firstAddress, secondAddress],
							identity,
							ownership: {
								atomFamily: true,
								headlessStore: true,
								rendererProjection: true,
								selector: false,
								transaction: true,
							},
						}),
				}),
			`ownership was not preserved`,
		],
		[
			`overlapping residency`,
			() =>
				validAdapter({
					exerciseResidency: () =>
						Promise.resolve({
							eagerComplete: false,
							firstResidentAddresses: [firstAddress],
							secondResidentAddresses: [firstAddress],
							totalMemberCount: 3,
						}),
				}),
			`disjoint member sets`,
		],
		[
			`partial atomic settlement`,
			() =>
				validAdapter({
					exerciseAtomicBatch: () =>
						Promise.resolve({
							affectedMembers: [firstAddress],
							logicalOperationCount: 2,
							revisionAfter: 2,
							revisionBefore: 1,
							selectorIntermediateValues: [0],
							selectorSettlements: 2,
						}),
				}),
			`partial gesture settlement`,
		],
		[
			`unsafe actor history`,
			() =>
				validAdapter({
					exerciseHistory: () =>
						Promise.resolve({
							baselineForeignProjection: 0,
							baselineOwnProjection: 0,
							foreignProjectionAfterForeignGesture: 2,
							foreignProjectionAfterRedo: 2,
							foreignProjectionAfterUndo: 0,
							ownProjectionAfterGesture: 1,
							ownProjectionAfterRedo: 1,
							ownProjectionAfterUndo: 0,
						}),
				}),
			`altered a foreign projection`,
		],
	] as const)(`fails closed for %s`, async (_case, createAdapter, reason) => {
		await expect(testMosaicDomainConformance(createAdapter())).rejects.toThrow(
			reason,
		)
	})
})
