import assert from "node:assert/strict"

import type { NpmReport } from "breakage"

export type PeerEnvironment = {
	id: string
	label: string
	directory: string
	packageName: string
	representative: string
	suites: string[]
}

export type PeerPlan = {
	commit: string
	environments: PeerEnvironment[]
	archives: Record<string, string>
	audits: NpmReport[]
}

export type PeerReceipt = {
	commit: string
	id: string
	archives: Record<string, string>
	report: NpmReport
}

export function verifyAudits(plan: PeerPlan): void {
	assert(plan.environments.length > 0, `No peer environments discovered.`)
	assert.equal(
		new Set(plan.environments.map(({ id }) => id)).size,
		plan.environments.length,
		`Duplicate environment identities.`,
	)
	const packageNames = [
		...new Set(plan.environments.map(({ packageName }) => packageName)),
	].sort()
	assert.deepEqual(
		plan.audits.map((audit) => audit.package.name).sort(),
		packageNames,
		`Missing or duplicate package audit.`,
	)
	for (const audit of plan.audits) {
		assert.equal(audit.mode, `coverage-only`)
		assert.equal(
			audit.exitCode,
			0,
			`Coverage audit failed for ${audit.package.name}.`,
		)
		assert.deepEqual(audit.errors, [])
		assert(
			[`unchanged`, `certified`, `first-release`].includes(audit.support.status),
			`Support audit did not pass for ${audit.package.name}.`,
		)
		assert(audit.coverage.length > 0)
		for (const coverage of audit.coverage)
			assert(
				coverage.representatives.length > 0,
				`Uncovered peer era: ${coverage.peer} ${coverage.era}.`,
			)
		const expected = plan.environments.filter(
			({ packageName }) => packageName === audit.package.name,
		)
		assert.deepEqual(
			audit.representatives.map(({ path }) => path).sort(),
			expected.map(({ representative }) => representative).sort(),
		)
		for (const environment of expected) {
			const result = audit.representatives.find(
				({ path }) => path === environment.representative,
			)!
			assert.equal(
				result.status,
				`audited`,
				`Environment was not audited: ${environment.id}.`,
			)
			assert.deepEqual(
				result.suites.map(({ peer }) => peer).sort(),
				environment.suites,
			)
			assert(environment.suites.length > 0)
		}
	}
}

export function verifyReceipts(plan: PeerPlan, receipts: PeerReceipt[]): void {
	verifyAudits(plan)
	assert.deepEqual(
		receipts.map(({ id }) => id).sort(),
		plan.environments.map(({ id }) => id).sort(),
		`Missing, duplicate, or unexpected environment receipts.`,
	)
	for (const environment of plan.environments) {
		const receipt = receipts.find(({ id }) => id === environment.id)!
		assert.equal(
			receipt.commit,
			plan.commit,
			`Receipt is from a different commit: ${environment.id}.`,
		)
		assert.deepEqual(
			receipt.archives,
			plan.archives,
			`Receipt used different candidate archives: ${environment.id}.`,
		)
		const { report } = receipt
		const audit = plan.audits.find(
			({ package: pkg }) => pkg.name === environment.packageName,
		)!
		assert.deepEqual(report.package, audit.package)
		assert.equal(report.mode, `test`)
		assert.equal(report.exitCode, 0, `Environment failed: ${environment.id}.`)
		assert.deepEqual(report.errors, [])
		assert.deepEqual(
			report.representatives.map(({ path }) => path).sort(),
			audit.representatives.map(({ path }) => path).sort(),
		)
		for (const result of report.representatives) {
			if (result.path !== environment.representative) {
				assert.equal(result.status, `skipped`)
				assert.deepEqual(result.suites, [])
				continue
			}
			assert.equal(
				result.status,
				`passed`,
				`Environment did not execute successfully: ${environment.id}.`,
			)
			assert.deepEqual(
				result.suites.map(({ peer }) => peer).sort(),
				environment.suites,
				`Missing or duplicate relationship suites: ${environment.id}.`,
			)
			for (const suite of result.suites)
				assert.equal(
					suite.status,
					`passed`,
					`Suite did not pass: ${environment.id} / ${suite.peer}.`,
				)
			const audited = audit.representatives.find(
				({ path }) => path === result.path,
			)!
			const identities = (peers: typeof result.peers) =>
				Object.fromEntries(
					Object.entries(peers).map(([name, { version, source }]) => [
						name,
						{ version, source },
					]),
				)
			assert.deepEqual(
				identities(result.peers),
				identities(audited.peers),
				`Installed peers differ from the audit: ${environment.id}.`,
			)
		}
	}
}
