import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test, type TestContext } from "node:test"
import { fileURLToPath } from "node:url"

import { breakage, breakagePrelude } from "breakage"
import { diff } from "semver"

import { certifyBreaking, createReleaseIntent } from "./breakage-release.ts"

const root = fileURLToPath(new URL(`../`, import.meta.url))
const fixture = path.join(root, `scripts/fixtures/breakage-release`)
const changesets = path.join(root, `node_modules/@changesets/cli/bin.js`)

async function prepare(
	t: TestContext,
	version = `0.53.3`,
	bump: `major` | `minor` | `patch` | null = `minor`,
) {
	const directory = await mkdtemp(path.join(os.tmpdir(), `atom-release-`))
	t.after(() => rm(directory, { recursive: true, force: true }))
	await cp(fixture, directory, { recursive: true })
	await symlink(
		path.join(root, `node_modules`),
		path.join(directory, `node_modules`),
		`dir`,
	)
	await mkdir(path.join(directory, `scripts`))
	for (const script of [
		`breakage-certify.ts`,
		`breakage-release.ts`,
		`breakage-peers.ts`,
	])
		await cp(
			path.join(root, `scripts`, script),
			path.join(directory, `scripts`, script),
		)
	const packageDirectory = path.join(directory, `packages/example`)
	const manifest = path.join(packageDirectory, `package.json`)
	await writeFile(
		manifest,
		JSON.stringify({ name: `fixture-core`, version, type: `module` }),
	)
	const changeset = path.join(directory, `.changeset/release.md`)
	const pending = (await readFile(changeset, `utf8`)).replace(
		`: minor`,
		`: ${bump}`,
	)
	await rm(changeset)
	const git = (...args: string[]) =>
		execFileSync(`git`, args, { cwd: directory, encoding: `utf8` }).trim()
	git(`init`, `--initial-branch=main`)
	git(`config`, `user.email`, `fixture@example.com`)
	git(`config`, `user.name`, `Fixture`)
	await writeFile(
		path.join(directory, `.gitignore`),
		`node_modules\n.breakage\n`,
	)
	git(`add`, `.`)
	git(`commit`, `-m`, `Released baseline`)
	git(`tag`, `fixture-core@${version}`)
	git(`remote`, `add`, `origin`, directory)
	await breakagePrelude({
		baseDirname: packageDirectory,
		tagPattern: `refs/tags/fixture-core@`,
		out: `.breakage/baseline.json`,
	})
	if (bump) await writeFile(changeset, pending)
	const certify = () =>
		spawnSync(
			process.execPath,
			[path.join(directory, `scripts/breakage-certify.ts`)],
			{
				cwd: packageDirectory,
				encoding: `utf8`,
			},
		)
	const versionPackages = () =>
		execFileSync(process.execPath, [changesets, `version`], {
			cwd: directory,
			encoding: `utf8`,
		})
	return {
		directory,
		packageDirectory,
		manifest,
		changeset,
		git,
		certify,
		versionPackages,
	}
}

for (const scenario of [
	{
		name: `pre-1.0 minor`,
		version: `0.53.3`,
		bump: `minor`,
		target: `0.54.0`,
		certified: true,
	},
	{
		name: `pre-1.0 patch`,
		version: `0.53.3`,
		bump: `patch`,
		target: `0.53.4`,
		certified: false,
	},
	{
		name: `stable major`,
		version: `1.2.3`,
		bump: `major`,
		target: `2.0.0`,
		certified: true,
	},
	{
		name: `stable minor`,
		version: `1.2.3`,
		bump: `minor`,
		target: `1.3.0`,
		certified: false,
	},
] as const) {
	await test(`${scenario.name} certification survives Changesets versioning`, async (t) => {
		const project = await prepare(t, scenario.version, scenario.bump)
		for (const phase of [`pending`, `versioned`] as const) {
			if (phase === `versioned`) {
				project.versionPackages()
				await assert.rejects(readFile(project.changeset), { code: `ENOENT` })
			}
			const manifest = JSON.parse(await readFile(project.manifest, `utf8`))
			assert.equal(
				manifest.version,
				phase === `pending` ? scenario.version : scenario.target,
			)
			const release = await createReleaseIntent(project.directory)({
				packageName: manifest.name,
				currentVersion: manifest.version,
				packageDirectory: project.packageDirectory,
			})
			assert.deepEqual(release, { status: `release`, version: scenario.target })
			assert.equal(
				await certifyBreaking({
					previousVersion: scenario.version,
					release: {
						version: scenario.target,
						delta: diff(scenario.version, scenario.target)!,
					},
					changes: [],
				}),
				scenario.certified,
			)
			await writeFile(
				path.join(project.packageDirectory, `value.json`),
				JSON.stringify({ value: `changed` }),
			)
			project.git(`add`, `.`)
			project.git(`commit`, `--allow-empty`, `-m`, phase)
			const outcome = await breakage({
				baseDirname: project.packageDirectory,
				baselineFile: `.breakage/baseline.json`,
				tagPattern: `refs/tags/fixture-core@`,
				testPattern: `tests/*.test.ts`,
				testCommand: `node tests/public.test.ts`,
				certifyCommand: `node ../../scripts/breakage-certify.ts`,
			})
			assert(`breakingChangesCertified` in outcome, outcome.summary)
			assert.equal(
				outcome.breakingChangesCertified,
				scenario.certified,
				outcome.summary,
			)
			const result = project.certify()
			assert.equal(
				result.status,
				scenario.certified ? 0 : 1,
				result.stdout + result.stderr,
			)
			assert.match(
				result.stdout,
				new RegExp(`${scenario.version} -> ${scenario.target}`),
			)
		}
	})
}

await test(`unchanged and downgraded versions do not certify breaking changes`, async (t) => {
	const project = await prepare(t, `0.53.3`, null)
	assert.equal(project.certify().status, 1)
	await writeFile(
		project.manifest,
		JSON.stringify({ name: `fixture-core`, version: `0.52.0` }),
	)
	assert.equal(project.certify().status, 1)
})

await test(`certification uses the pinned baseline even when a newer tag appears`, async (t) => {
	const project = await prepare(t)
	project.versionPackages()
	project.git(`add`, `.`)
	project.git(`commit`, `-m`, `Version Packages`)
	project.git(`tag`, `fixture-core@0.54.0`)
	assert.equal(project.certify().status, 0)
	await breakagePrelude({
		baseDirname: project.packageDirectory,
		tagPattern: `refs/tags/fixture-core@`,
		out: `.breakage/baseline.json`,
	})
	assert.equal(project.certify().status, 1)
})

await test(`a missing or mismatched baseline cannot certify breaking changes`, async (t) => {
	const project = await prepare(t)
	const filename = path.join(project.packageDirectory, `.breakage/baseline.json`)
	const baseline = JSON.parse(await readFile(filename, `utf8`))
	await writeFile(
		filename,
		JSON.stringify({ ...baseline, packageDirectory: `packages/other/` }),
	)
	assert.notEqual(project.certify().status, 0)
	await rm(filename)
	assert.notEqual(project.certify().status, 0)
})
