import assert from "node:assert/strict"
import { test } from "node:test"

import type { PeerPlan, PeerReceipt } from "./breakage-receipts.ts"
import { verifyAudits, verifyReceipts } from "./breakage-receipts.ts"

function fixture(): { plan: PeerPlan; receipts: PeerReceipt[] } {
	const environments = [`react18`, `react19`].map((name) => ({
		id: name,
		label: name,
		directory: `packages/react`,
		packageName: `@atom.io/react`,
		representative: `peer-environments/${name}`,
		suites: [`atom.io`, `react`],
	}))
	const plan: PeerPlan = {
		commit: `candidate-commit`,
		environments,
		archives: { "packages/react/.breakage/package.tgz": `candidate-digest` },
		audits: [
			{
				package: { name: `@atom.io/react`, version: `0.0.0` },
				mode: `coverage-only`,
				exitCode: 0,
				errors: [],
				support: { status: `first-release`, changes: [] },
				coverage: [
					{
						peer: `react`,
						era: `^18`,
						representatives: [environments[0].representative],
					},
					{
						peer: `react`,
						era: `^19`,
						representatives: [environments[1].representative],
					},
				],
				representatives: environments.map((environment, index) => ({
					path: environment.representative,
					status: `audited`,
					peers: {
						"atom.io": {
							version: `0.54.0`,
							source: `candidate`,
							path: `/prologue/sdk`,
						},
						react: {
							version: `${18 + index}.0.0`,
							source: `installed`,
							path: `/prologue/react`,
						},
					},
					suites: environment.suites.map((peer) => ({
						peer,
						status: `not-run`,
					})),
					warnings: [],
				})),
			},
		],
	}
	const receipts: PeerReceipt[] = environments.map((environment) => {
		const report = structuredClone(plan.audits[0])
		report.mode = `test`
		report.support = { status: `not-checked`, changes: [] }
		for (const result of report.representatives) {
			const selected = result.path === environment.representative
			result.status = selected ? `passed` : `skipped`
			result.suites = selected
				? result.suites.map(({ peer }) => ({ peer, status: `passed` }))
				: []
			if (selected) {
				for (const peer of Object.values(result.peers))
					peer.path = `/matrix/${peer.version}`
			}
		}
		return {
			id: environment.id,
			commit: plan.commit,
			archives: structuredClone(plan.archives),
			report,
		}
	})
	return { plan, receipts }
}

await test(`accepts complete receipts across different runner paths`, () => {
	const { plan, receipts } = fixture()
	verifyReceipts(plan, receipts.reverse())
})

const invalidReceipts: [string, (receipts: PeerReceipt[]) => void][] = [
	[
		`missing environment`,
		(receipts) => {
			receipts.pop()
		},
	],
	[
		`duplicate replacing missing environment`,
		(receipts) => {
			receipts[1] = structuredClone(receipts[0])
		},
	],
	[
		`unexpected environment`,
		(receipts) => {
			receipts[0].id = `unknown`
		},
	],
	[
		`different commit`,
		(receipts) => {
			receipts[0].commit = `stale-commit`
		},
	],
	[
		`different candidate archive`,
		(receipts) => {
			receipts[0].archives[`packages/react/.breakage/package.tgz`] =
				`stale-digest`
		},
	],
	[
		`wrong package`,
		(receipts) => {
			receipts[0].report.package.name = `another-package`
		},
	],
	[
		`audit substituted for execution`,
		(receipts) => {
			receipts[0].report.mode = `coverage-only`
		},
	],
	[
		`failed environment`,
		(receipts) => {
			receipts[0].report.exitCode = 1
		},
	],
	[
		`skipped environment with zero exit code`,
		(receipts) => {
			receipts[0].report.representatives[0].status = `skipped`
		},
	],
	[
		`omitted selected environment`,
		(receipts) => {
			receipts[0].report.representatives.shift()
		},
	],
	[
		`missing suite despite passing status`,
		(receipts) => {
			receipts[0].report.representatives[0].suites.pop()
		},
	],
	[
		`duplicate suite replacing missing suite`,
		(receipts) => {
			const suites = receipts[0].report.representatives[0].suites
			suites[1] = structuredClone(suites[0])
		},
	],
	[
		`unexecuted suite`,
		(receipts) => {
			receipts[0].report.representatives[0].suites[0].status = `not-run`
		},
	],
	[
		`failed suite despite zero exit code`,
		(receipts) => {
			receipts[0].report.representatives[0].suites[0].status = `compatibility-failure`
		},
	],
	[
		`wrong installed peer`,
		(receipts) => {
			receipts[0].report.representatives[0].peers[`react`].version = `20.0.0`
		},
	],
	[
		`malformed report`,
		(receipts) => {
			Object.assign(receipts[0], { report: {} })
		},
	],
]

for (const [name, mutate] of invalidReceipts) {
	await test(`rejects ${name}`, () => {
		const { plan, receipts } = fixture()
		mutate(receipts)
		assert.throws(() => {
			verifyReceipts(plan, receipts)
		})
	})
}

await test(`coverage audit rejects an uncovered era`, () => {
	const { plan } = fixture()
	plan.audits[0].coverage[1].representatives = []
	assert.throws(() => {
		verifyAudits(plan)
	})
})

await test(`coverage audit rejects an omitted environment`, () => {
	const { plan } = fixture()
	plan.audits[0].representatives.pop()
	assert.throws(() => {
		verifyAudits(plan)
	})
})

await test(`coverage audit rejects an unapproved support change`, () => {
	const { plan } = fixture()
	plan.audits[0].support.status = `end-of-support`
	assert.throws(() => {
		verifyAudits(plan)
	})
})
