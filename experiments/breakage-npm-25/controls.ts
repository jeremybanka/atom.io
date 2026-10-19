import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

type Report = {
	exitCode: number
	errors: string[]
	representatives: { path: string; status: string; error?: string }[]
}

type Trial = {
	config: { representatives: string }
	directory: string
	representative: string
	npmCheck: (config: object, options: object) => Promise<Report>
	npmTest: (
		config: object,
		selection: object,
		options: object,
	) => Promise<Report>
	pack: (directory: string, artifact: string) => Promise<void>
}

export async function checkControls({
	config,
	directory,
	representative,
	npmCheck,
	npmTest,
	pack,
}: Trial): Promise<{ package: string; check: string; rejected: true }[]> {
	const filename = join(directory, `package.json`)
	const original = await readFile(filename, `utf8`)
	const manifest = JSON.parse(original)
	const controls: { package: string; check: string; rejected: true }[] = []
	const record = (check: string): void => {
		controls.push({ package: manifest.name, check, rejected: true })
	}
	const options = { baseDirectory: directory }
	const missingIntent = await npmTest(
		{ ...config, releaseIntent: () => ({ status: `none` }) },
		{ representative: `peer-environments/coordinated-${representative}` },
		options,
	)
	assert.equal(missingIntent.exitCode, 2, JSON.stringify(missingIntent))
	assert(
		missingIntent.representatives.some((rep) =>
			rep.error?.includes(`no certified release intent`),
		),
	)
	record(`missing candidate release intent`)

	// A released SDK passing its contracts cannot satisfy the planned SDK gate.
	const missingCandidate = await npmCheck(
		{ ...config, representatives: `peer-environments/released-*` },
		{ ...options, coverageOnly: true },
	)
	assert.equal(missingCandidate.exitCode, 2, JSON.stringify(missingCandidate))
	assert(
		missingCandidate.errors.some((error) =>
			error.includes(
				`No coordinated representative covers planned local peer atom.io@0.54.0`,
			),
		),
	)
	record(`missing coordinated SDK representative`)

	try {
		await writeFile(
			filename,
			JSON.stringify({
				...manifest,
				peerDependencies: { ...manifest.peerDependencies, "atom.io": `^0.53.3` },
			}),
		)
		const excluded = await npmCheck(config, { ...options, coverageOnly: true })
		assert.equal(excluded.exitCode, 2, JSON.stringify(excluded))
		assert(
			excluded.errors.some((error) =>
				error.includes(`does not include its planned local release 0.54.0`),
			),
		)
		record(`excluded planned SDK version`)
		if (manifest.name === `@atom.io/react`) {
			await writeFile(
				filename,
				JSON.stringify({
					...manifest,
					peerDependencies: {
						...manifest.peerDependencies,
						"atom.io": `workspace:^`,
					},
				}),
			)
			const moving = await npmCheck(config, { ...options, coverageOnly: true })
			assert.equal(moving.exitCode, 2, JSON.stringify(moving))
			assert(
				moving.errors.some((error) =>
					error.includes(`Moving workspace peer range`),
				),
			)
			record(`moving workspace peer shorthand`)
		}
	} finally {
		await writeFile(filename, original)
	}

	if (manifest.name === `@atom.io/react`) {
		const source = join(directory, `dist/index.js`)
		const originalSource = await readFile(source, `utf8`)
		const mutated = originalSource.replace(
			`function useO(...params) {`,
			`function useO(...params) { return 0;`,
		)
		assert.notEqual(
			mutated,
			originalSource,
			`The probe must modify the packed hook.`,
		)
		try {
			await writeFile(source, mutated)
			await pack(directory, `mutated.tgz`)
		} finally {
			await writeFile(source, originalSource)
		}
		const broken = await npmTest(
			{ ...config, artifact: `artifacts/mutated.tgz` },
			{ representative: `peer-environments/coordinated-${representative}` },
			options,
		)
		assert.equal(broken.exitCode, 1, JSON.stringify(broken))
		assert(
			broken.representatives.some(
				(rep) => rep.status === `compatibility-failure`,
			),
		)
		record(`broken packed React hook`)
	}
	return controls
}
