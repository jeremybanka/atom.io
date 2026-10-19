import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const root = fileURLToPath(new URL(`../../`, import.meta.url))
const { resolveWorkspacePeers } = await import(
	`${root}.breakage/npm25-tool/src/npm/manifest.ts`
)
const { currentManifest, previousManifest } = await import(
	`${root}.breakage/npm25-tool/src/npm/release.ts`
)
const { stageCandidate } = await import(
	`${root}.breakage/npm25-tool/src/npm/environment.ts`
)

test(`workspace shorthand matches pnpm's packed ranges and preserves optionality`, async () => {
	for (const [range, expected] of [
		[`workspace:^`, `^0.53.3`],
		[`workspace:~`, `~0.53.3`],
		[`workspace:*`, `0.53.3`],
		[`workspace:^0.50.0`, `^0.50.0`],
		[`^18 || ^19`, `^18 || ^19`],
	]) {
		const manifest = {
			name: `test-integration`,
			version: `0.0.0`,
			peerDependencies: { "atom.io": range },
			peerDependenciesMeta: { "atom.io": { optional: true } },
		}
		const result = await resolveWorkspacePeers(manifest, async () => `0.53.3`)
		assert.equal(result.peerDependencies[`atom.io`], expected)
		assert.equal(result.peerDependenciesMeta[`atom.io`].optional, true)
		assert.equal(manifest.peerDependencies[`atom.io`], range)
	}
})

test(`unsupported workspace syntax and unresolved peers fail explicitly`, async () => {
	await assert.rejects(
		() =>
			resolveWorkspacePeers(
				{
					name: `x`,
					version: `0.0.0`,
					peerDependencies: { "atom.io": `workspace:../core` },
				},
				async () => `0.53.3`,
			),
		/Unsupported workspace/,
	)
	await assert.rejects(
		() => currentManifest({ localPeers: {} }, `${root}packages/react`),
		/needs a localPeers directory/,
	)
})

test(`historical ranges use the peer version in the same commit`, async () => {
	const directory = `${root}packages/react`
	const source = `${root}packages/atom.io/package.json`
	const original = await readFile(source, `utf8`)
	const { stdout } = await promisify(execFile)(`git`, [`rev-parse`, `HEAD`], {
		cwd: root,
	})
	await mkdir(`${directory}/.breakage`, { recursive: true })
	await writeFile(
		`${directory}/.breakage/workspace-probe.json`,
		JSON.stringify({
			version: 1,
			tagPattern: null,
			packageDirectory: `packages/react/`,
			ref: `refs/tags/local-workspace-probe`,
			commit: stdout.trim(),
		}),
	)
	const config = {
		localPeers: {
			"atom.io": { directory: `../atom.io`, artifact: `unused.tgz` },
		},
		baseline: { baselineFile: `.breakage/workspace-probe.json` },
	}
	try {
		await writeFile(
			source,
			JSON.stringify({ ...JSON.parse(original), version: `0.99.0` }),
		)
		const current = await currentManifest(config, directory)
		const previous = await previousManifest(config, directory)
		assert.equal(current.peerDependencies[`atom.io`], `^0.99.0`)
		assert.equal(previous.peerDependencies[`atom.io`], `^0.53.3`)
	} finally {
		await writeFile(source, original)
	}
})

test(`candidate version rewriting preserves hard-linked cache manifests`, async () => {
	const fixture = `${root}.breakage/npm25-manifest-regression`
	await rm(fixture, { recursive: true, force: true })
	const stage = `${fixture}/test`
	await mkdir(stage, { recursive: true })
	const manifest = {
		name: `@atom.io/react`,
		version: `0.0.1`,
		peerDependencies: { "atom.io": `^0.54.0` },
	}
	const cached = JSON.stringify({ name: `atom.io`, version: `0.53.3` })
	await writeFile(`${fixture}/target.json`, JSON.stringify(manifest))
	await writeFile(`${fixture}/cached-peer.json`, cached)
	await writeFile(`${fixture}/target.tgz`, `unit fixture`)
	await writeFile(`${fixture}/peer.tgz`, `unit fixture`)
	process.env[`ATOM_IO_MANIFEST_FIXTURE`] = fixture
	try {
		await stageCandidate(
			{
				artifact: `target.tgz`,
				installCommand: `node '${root}experiments/breakage-npm-25/install-manifest-fixture.node.ts'`,
			},
			fixture,
			manifest,
			{
				directory: fixture,
				stage,
				manifest: {},
				peers: {
					"atom.io": {
						version: `0.54.0`,
						path: `${stage}/node_modules/atom.io`,
						source: `candidate`,
					},
				},
				candidates: {
					"atom.io": {
						directory: fixture,
						artifact: `${fixture}/peer.tgz`,
						currentVersion: `0.53.3`,
						version: `0.54.0`,
					},
				},
			},
			[],
		)
		assert.equal(await readFile(`${fixture}/cached-peer.json`, `utf8`), cached)
		assert.equal(
			JSON.parse(
				await readFile(`${stage}/node_modules/atom.io/package.json`, `utf8`),
			).version,
			`0.54.0`,
		)
	} finally {
		delete process.env[`ATOM_IO_MANIFEST_FIXTURE`]
	}
})
