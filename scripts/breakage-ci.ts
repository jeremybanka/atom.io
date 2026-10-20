import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import {
	appendFile,
	copyFile,
	glob,
	mkdir,
	readdir,
	readFile,
	writeFile,
} from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { getPackages } from "@manypkg/get-packages"
import type { NpmConfig } from "breakage"
import { formatNpmReport, npmCheck, npmTest } from "breakage"

import type {
	PeerEnvironment,
	PeerPlan,
	PeerReceipt,
} from "./breakage-receipts.ts"
import { verifyAudits, verifyReceipts } from "./breakage-receipts.ts"

const root = fileURLToPath(new URL(`../`, import.meta.url))
const bundle = path.join(root, `.breakage/peer-bundle`)
const receiptDirectory = path.join(root, `.breakage/peer-receipts`)
const commit = execFileSync(`git`, [`rev-parse`, `HEAD`], {
	cwd: root,
	encoding: `utf8`,
}).trim()

async function discover(): Promise<
	{ directory: string; config: NpmConfig; environments: PeerEnvironment[] }[]
> {
	const { packages } = await getPackages(root)
	const found = []
	for (const pkg of packages) {
		const filename = [`breakage.config.ts`, `breakage.config.json`]
			.map((name) => path.join(pkg.dir, name))
			.find(existsSync)
		if (!filename) continue
		const loaded = (
			filename.endsWith(`.json`)
				? JSON.parse(await readFile(filename, `utf8`))
				: (await import(pathToFileURL(filename).href)).default
		) as { npm?: NpmConfig }
		if (!loaded.npm) continue
		const config = loaded.npm
		const directory = path.relative(root, pkg.dir)
		const base = path.resolve(pkg.dir, config.packageDirectory ?? `.`)
		const manifest = JSON.parse(
			await readFile(path.join(base, `package.json`), `utf8`),
		) as {
			peerDependencies?: Record<string, string>
			peerDependenciesMeta?: Record<string, { optional?: boolean }>
		}
		for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
			if (!manifest.peerDependenciesMeta?.[peer]?.optional)
				assert(
					config.suites[peer],
					`Missing relationship suite for ${pkg.packageJson.name}: ${peer}.`,
				)
		}
		const representatives = new Set<string>()
		for await (const name of glob(config.representatives, {
			cwd: base,
			exclude: [`**/node_modules/**`, `**/test/**`, `**/.git/**`],
		}))
			representatives.add(name)
		assert(
			representatives.size > 0,
			`No environments configured for ${pkg.packageJson.name}.`,
		)
		const environments = [...representatives].sort().map((representative) => ({
			id: createHash(`sha256`)
				.update(`${directory}/${representative}`)
				.digest(`hex`)
				.slice(0, 16),
			directory,
			packageName: pkg.packageJson.name,
			representative,
			suites: Object.keys(config.suites).sort(),
		}))
		found.push({ directory, config, environments })
	}
	return found.sort((a, b) => a.directory.localeCompare(b.directory))
}

async function digest(filename: string): Promise<string> {
	return createHash(`sha256`)
		.update(await readFile(filename))
		.digest(`hex`)
}

async function writeJson(filename: string, value: unknown): Promise<void> {
	await mkdir(path.dirname(filename), { recursive: true })
	await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`)
}

async function prologue(): Promise<void> {
	const packages = await discover()
	const audits = await Promise.all(
		packages.map(async ({ directory, config }) => {
			const report = await npmCheck(config, {
				baseDirectory: path.join(root, directory),
				coverageOnly: true,
			})
			console.log(formatNpmReport(report))
			return report
		}),
	)
	const plan: PeerPlan = {
		commit,
		environments: packages.flatMap(({ environments }) => environments),
		audits,
		archives: {},
	}
	verifyAudits(plan)
	const packDirectories = new Set<string>()
	const archives = new Set<string>()
	for (const { directory, config } of packages) {
		const base = path.resolve(root, directory, config.packageDirectory ?? `.`)
		packDirectories.add(base)
		archives.add(path.resolve(base, config.artifact))
		for (const peer of Object.values(config.localPeers ?? {})) {
			packDirectories.add(path.resolve(base, peer.directory))
			archives.add(path.resolve(base, peer.artifact))
		}
	}
	const filters = await Promise.all(
		[...packDirectories].map(async (directory) => {
			const manifest = JSON.parse(
				await readFile(path.join(directory, `package.json`), `utf8`),
			) as { name: string }
			return `--filter=${manifest.name}`
		}),
	)
	execFileSync(`pnpm`, [`exec`, `turbo`, `run`, `pack:breakage`, ...filters], {
		cwd: root,
		stdio: `inherit`,
	})
	for (const filename of [...archives].sort()) {
		const relative = path.relative(root, filename)
		assert(!relative.startsWith(`..`) && !path.isAbsolute(relative))
		plan.archives[relative] = await digest(filename)
		await mkdir(path.dirname(path.join(bundle, relative)), { recursive: true })
		await copyFile(filename, path.join(bundle, relative))
	}
	await writeJson(path.join(bundle, `plan.json`), plan)
	const output = process.env[`GITHUB_OUTPUT`]
	if (output)
		await appendFile(
			output,
			`matrix=${JSON.stringify({ include: plan.environments.map(({ id, packageName, representative }) => ({ id, packageName, representative })) })}\n`,
		)
	console.log(
		`Audited ${plan.environments.length} environments; prepared ${archives.size} candidate archives.`,
	)
}

async function readPlan(): Promise<PeerPlan> {
	const plan = JSON.parse(
		await readFile(path.join(bundle, `plan.json`), `utf8`),
	) as PeerPlan
	assert.equal(plan.commit, commit, `Peer plan belongs to another commit.`)
	assert.deepEqual(
		plan.environments,
		(await discover()).flatMap(({ environments }) => environments),
		`Peer plan does not enumerate every configured environment.`,
	)
	verifyAudits(plan)
	assert(Object.keys(plan.archives).length > 0)
	for (const [filename, expected] of Object.entries(plan.archives)) {
		assert.equal(
			await digest(path.join(bundle, filename)),
			expected,
			`Candidate archive changed: ${filename}.`,
		)
	}
	return plan
}

async function exercise(id: string | undefined): Promise<void> {
	const plan = await readPlan()
	const environment = plan.environments.find((entry) => entry.id === id)
	assert(environment, `Unknown peer environment: ${id}.`)
	for (const filename of Object.keys(plan.archives)) {
		await mkdir(path.dirname(path.join(root, filename)), { recursive: true })
		await copyFile(path.join(bundle, filename), path.join(root, filename))
	}
	const pkg = (await discover()).find(
		({ directory }) => directory === environment.directory,
	)!
	const report = await npmTest(
		pkg.config,
		{ representative: environment.representative },
		{ baseDirectory: path.join(root, pkg.directory) },
	)
	const receipt: PeerReceipt = {
		id: environment.id,
		commit,
		archives: plan.archives,
		report,
	}
	await writeJson(path.join(receiptDirectory, `${environment.id}.json`), receipt)
	console.log(formatNpmReport(report))
	process.exitCode = report.exitCode
}

async function epilogue(): Promise<void> {
	const needs = JSON.parse(process.env[`BREAKAGE_NEEDS`] ?? `{}`) as Record<
		string,
		{ result: string }
	>
	for (const name of [`PeerPrologue`, `PeerEnvironment`, `BreakageHistory`])
		assert.equal(needs[name]?.result, `success`, `${name} did not succeed.`)
	const plan = await readPlan()
	const receipts = await Promise.all(
		(await readdir(receiptDirectory, { recursive: true }))
			.filter((filename) => filename.endsWith(`.json`))
			.map(
				async (filename) =>
					JSON.parse(
						await readFile(path.join(receiptDirectory, filename), `utf8`),
					) as PeerReceipt,
			),
	)
	verifyReceipts(plan, receipts)
	console.log(
		`Verified passing receipts for all ${plan.environments.length} configured peer environments.`,
	)
}

switch (process.argv[2]) {
	case `prologue`:
		await prologue()
		break
	case `test`:
		await exercise(process.argv[3])
		break
	case `epilogue`:
		await epilogue()
		break
	default:
		throw new Error(`Expected prologue, test <environment-id>, or epilogue.`)
}
