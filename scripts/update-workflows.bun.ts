#!/usr/bin/env bun
import path from "node:path"

import { $ } from "bun"

type WorkflowUse = {
	filePath: string
	lineIndex: number
	prefix: string
	actionName: string
	currentRef: string
	currentVersion: string
	originalComment: string | null
}

type ActionInputVersionUse = {
	filePath: string
	lineIndex: number
	prefix: string
	depName: string
	repository: string
	containerImage: string | null
	currentVersion: string
}

type ActionGroup = {
	actionName: string
	currentVersion: string
	currentRef: string
	occurrences: WorkflowUse[]
}

type ActionInputVersionGroup = {
	depName: string
	repository: string
	containerImage: string | null
	currentVersion: string
	occurrences: ActionInputVersionUse[]
}

type ParsedVersion = {
	major: number
	minor: number
	patch: number
	prerelease: string | null
	segments: number
}

type ResolvedUpdate = {
	depName: string
	currentVersion: string
	currentRef: string
	currentShortRef: string
	targetVersion: string
	targetRef: string
	hasUpdate: boolean
}

type ResolvedActionInputUpdate = {
	depName: string
	currentVersion: string
	targetVersion: string
	hasUpdate: boolean
}

type WorkflowInventory = {
	workflowUses: WorkflowUse[]
	actionInputVersionUses: ActionInputVersionUse[]
}

type ActionInputVersionConfig = {
	depName: string
	repository: string
	containerImage?: string
	inputName: string
}

const SHA_PATTERN = /^[0-9a-f]{40}$/i
const USES_PATTERN =
	/^(?<prefix>\s*(?:-\s+)?uses:\s+)(?<action>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@(?<ref>[^\s#]+)(?:\s+#\s*(?<comment>[^\r\n]+))?\s*$/
const ACTION_INPUT_VERSION_CONFIGS: Record<string, ActionInputVersionConfig> = {
	"jdx/mise-action": {
		depName: `jdx/mise`,
		repository: `jdx/mise`,
		inputName: `version`,
	},
	"renovatebot/github-action": {
		depName: `ghcr.io/renovatebot/renovate`,
		repository: `renovatebot/renovate`,
		containerImage: `renovatebot/renovate`,
		inputName: `renovate-version`,
	},
}
const ANSI = {
	reset: `\x1b[0m`,
	white: `\x1b[37m`,
	green: `\x1b[32m`,
	cyan: `\x1b[36m`,
}

async function main(): Promise<void> {
	const isDryRun = process.argv.includes(`--dry-run`)
	const workspaceRoot = process.cwd()
	const workflowFiles = await listWorkflowFiles(workspaceRoot)
	const { workflowUses, actionInputVersionUses } =
		await collectWorkflowInventory(workflowFiles)

	if (workflowUses.length === 0 && actionInputVersionUses.length === 0) {
		console.log(`No external workflow dependencies found under .github`)
		return
	}

	const groups = groupWorkflowUses(workflowUses)
	const updates = await resolveUpdates(groups)
	const actionInputGroups = groupActionInputVersionUses(actionInputVersionUses)
	const actionInputUpdates = await resolveActionInputUpdates(actionInputGroups)

	for (const update of updates) {
		if (update.hasUpdate) {
			console.log(
				`${colorWhite(update.depName)} ${colorGreen(update.currentVersion)} ${colorCyan(`(${update.currentShortRef})`)} ${colorCyan(`->`)} ${colorGreen(update.targetVersion)} ${colorCyan(`(${shortSha(update.targetRef)})`)} ✨`,
			)
		} else {
			console.log(
				`${colorWhite(update.depName)} ${colorGreen(update.currentVersion)} ${colorCyan(`(${update.currentShortRef})`)}`,
			)
		}
	}

	for (const update of actionInputUpdates) {
		if (update.hasUpdate) {
			console.log(
				`${colorWhite(update.depName)} ${colorGreen(update.currentVersion)} ${colorCyan(`->`)} ${colorGreen(update.targetVersion)} ✨`,
			)
		} else {
			console.log(
				`${colorWhite(update.depName)} ${colorGreen(update.currentVersion)}`,
			)
		}
	}

	if (isDryRun) {
		console.log(`Dry run: no files updated`)
		return
	}

	const updatesByKey = new Map(
		updates.map((update) => [
			groupKey(update.depName, update.currentVersion),
			update,
		]),
	)
	const actionInputUpdatesByKey = new Map(
		actionInputUpdates.map((update) => [
			groupKey(update.depName, update.currentVersion),
			update,
		]),
	)
	const filesToWrite = new Map<string, string[]>()

	for (const workflowUse of workflowUses) {
		const update = updatesByKey.get(
			groupKey(workflowUse.actionName, workflowUse.currentVersion),
		)

		if (!update?.hasUpdate) {
			continue
		}

		const fileLines =
			filesToWrite.get(workflowUse.filePath) ??
			(await Bun.file(workflowUse.filePath).text()).split(/\r?\n/)
		fileLines[workflowUse.lineIndex] =
			`${workflowUse.prefix}${workflowUse.actionName}@${update.targetRef} # ${withVersionPrefix(update.targetVersion)}`
		filesToWrite.set(workflowUse.filePath, fileLines)
	}

	for (const actionInputVersionUse of actionInputVersionUses) {
		const update = actionInputUpdatesByKey.get(
			groupKey(
				actionInputVersionUse.depName,
				actionInputVersionUse.currentVersion,
			),
		)

		if (!update?.hasUpdate) {
			continue
		}

		const fileLines =
			filesToWrite.get(actionInputVersionUse.filePath) ??
			(await Bun.file(actionInputVersionUse.filePath).text()).split(/\r?\n/)
		fileLines[actionInputVersionUse.lineIndex] =
			`${actionInputVersionUse.prefix}${update.targetVersion}`
		filesToWrite.set(actionInputVersionUse.filePath, fileLines)
	}

	for (const [filePath, fileLines] of filesToWrite) {
		await Bun.write(filePath, fileLines.join(`\n`))
	}

	console.log(`Updated ${filesToWrite.size} file(s)`)
}

async function listWorkflowFiles(workspaceRoot: string): Promise<string[]> {
	const githubDir = path.join(workspaceRoot, `.github`)
	const command = $`rg --files ${githubDir}`.quiet()
	const output = await command.text()

	return output
		.split(`\n`)
		.map((line) => line.trim())
		.filter((line) => line.endsWith(`.yml`) || line.endsWith(`.yaml`))
		.sort((left, right) => left.localeCompare(right))
}

async function collectWorkflowInventory(
	filePaths: string[],
): Promise<WorkflowInventory> {
	const workflowUses: WorkflowUse[] = []
	const actionInputVersionUses: ActionInputVersionUse[] = []

	for (const filePath of filePaths) {
		const fileLines = (await Bun.file(filePath).text()).split(/\r?\n/)

		for (const [lineIndex, line] of fileLines.entries()) {
			const match = USES_PATTERN.exec(line)
			if (!match?.groups) {
				continue
			}

			const actionName = match.groups[`action`]
			const prefix = match.groups[`prefix`]
			const currentRef = match.groups[`ref`]
			const originalComment = match.groups[`comment`]?.trim() ?? null
			if (!actionName || !originalComment || !currentRef || !prefix) {
				continue
			}
			if (actionName.startsWith(`./`)) {
				continue
			}

			const currentVersion = normalizeVersion(originalComment ?? currentRef)

			workflowUses.push({
				filePath,
				lineIndex,
				prefix,
				actionName,
				currentRef,
				currentVersion,
				originalComment,
			})

			const actionInputVersionConfig = ACTION_INPUT_VERSION_CONFIGS[actionName]
			if (actionInputVersionConfig) {
				const actionInputVersionUse = findActionInputVersionUse(
					filePath,
					fileLines,
					lineIndex,
					actionInputVersionConfig,
				)
				if (actionInputVersionUse) {
					actionInputVersionUses.push(actionInputVersionUse)
				}
			}
		}
	}

	return { workflowUses, actionInputVersionUses }
}

function groupWorkflowUses(workflowUses: WorkflowUse[]): ActionGroup[] {
	const groups = new Map<string, ActionGroup>()

	for (const workflowUse of workflowUses) {
		const key = groupKey(workflowUse.actionName, workflowUse.currentVersion)
		const existingGroup = groups.get(key)

		if (existingGroup) {
			existingGroup.occurrences.push(workflowUse)
			continue
		}

		groups.set(key, {
			actionName: workflowUse.actionName,
			currentVersion: workflowUse.currentVersion,
			currentRef: workflowUse.currentRef,
			occurrences: [workflowUse],
		})
	}

	return [...groups.values()].sort((left, right) =>
		left.actionName.localeCompare(right.actionName),
	)
}

function groupActionInputVersionUses(
	actionInputVersionUses: ActionInputVersionUse[],
): ActionInputVersionGroup[] {
	const groups = new Map<string, ActionInputVersionGroup>()

	for (const actionInputVersionUse of actionInputVersionUses) {
		const key = groupKey(
			actionInputVersionUse.depName,
			actionInputVersionUse.currentVersion,
		)
		const existingGroup = groups.get(key)

		if (existingGroup) {
			existingGroup.occurrences.push(actionInputVersionUse)
			continue
		}

		groups.set(key, {
			depName: actionInputVersionUse.depName,
			repository: actionInputVersionUse.repository,
			containerImage: actionInputVersionUse.containerImage,
			currentVersion: actionInputVersionUse.currentVersion,
			occurrences: [actionInputVersionUse],
		})
	}

	return [...groups.values()].sort((left, right) =>
		left.depName.localeCompare(right.depName),
	)
}

async function resolveUpdates(groups: ActionGroup[]): Promise<ResolvedUpdate[]> {
	const repoTagCache = new Map<string, string[]>()

	return Promise.all(
		groups.map(async (group) => {
			const [owner, repo] = group.actionName.split(`/`)
			const repository = `${owner}/${repo}`
			const availableTags = await getRepositoryTags(repository, repoTagCache)
			const targetTag = selectLatestTag(availableTags)

			if (!targetTag) {
				return {
					depName: group.actionName,
					currentVersion: group.currentVersion,
					currentRef: group.currentRef,
					currentShortRef: shortSha(group.currentRef),
					targetVersion: group.currentVersion,
					targetRef: group.currentRef,
					hasUpdate: false,
				}
			}

			const targetRef = await resolveTagCommit(repository, targetTag)
			const targetVersion = normalizeVersion(targetTag)
			const hasUpdate =
				group.currentRef !== targetRef || group.currentVersion !== targetVersion

			return {
				depName: group.actionName,
				currentVersion: group.currentVersion,
				currentRef: group.currentRef,
				currentShortRef: shortSha(group.currentRef),
				targetVersion,
				targetRef,
				hasUpdate,
			}
		}),
	)
}

async function resolveActionInputUpdates(
	groups: ActionInputVersionGroup[],
): Promise<ResolvedActionInputUpdate[]> {
	if (groups.length === 0) {
		return []
	}

	const repoTagCache = new Map<string, string[]>()

	return Promise.all(
		groups.map(async (group) => {
			const availableTags = await getRepositoryTags(
				group.repository,
				repoTagCache,
			)
			const targetTag = group.containerImage
				? await selectLatestPublishedContainerTag(
						availableTags,
						group.containerImage,
					)
				: selectLatestTag(availableTags)
			const targetVersion = targetTag
				? normalizeVersion(targetTag)
				: group.currentVersion

			return {
				depName: group.depName,
				currentVersion: group.currentVersion,
				targetVersion,
				hasUpdate: group.currentVersion !== targetVersion,
			}
		}),
	)
}

async function getRepositoryTags(
	repository: string,
	cache: Map<string, string[]>,
): Promise<string[]> {
	const cachedTags = cache.get(repository)
	if (cachedTags) {
		return cachedTags
	}

	const remote = `https://github.com/${repository}.git`
	const output = await $`git ls-remote --tags --refs ${remote}`.quiet().text()
	const tags = output
		.split(`\n`)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.split(/\s+/)[1]?.replace(`refs/tags/`, ``) ?? ``)
		.filter(Boolean)

	cache.set(repository, tags)
	return tags
}

function selectLatestTag(tags: string[]): string | null {
	return getSortedVersionTags(tags)[0] ?? null
}

function getSortedVersionTags(tags: string[]): string[] {
	const parsedTags = tags
		.map((tag) => ({ tag, parsed: parseVersion(tag) }))
		.filter(
			(entry): entry is { tag: string; parsed: ParsedVersion } =>
				entry.parsed !== null,
		)
		.filter((entry) => entry.parsed.prerelease === null)

	if (parsedTags.length === 0) {
		return []
	}

	parsedTags.sort((left, right) => compareVersions(right.parsed, left.parsed))
	return parsedTags.map((entry) => entry.tag)
}

async function selectLatestPublishedContainerTag(
	tags: string[],
	image: string,
): Promise<string | null> {
	const scope = encodeURIComponent(`repository:${image}:pull`)
	const tokenResponse = await fetch(`https://ghcr.io/token?scope=${scope}`)
	if (!tokenResponse.ok) {
		throw new Error(
			`Unable to authenticate with GHCR for ${image}: ${tokenResponse.status}`,
		)
	}
	const tokenPayload = (await tokenResponse.json()) as { token?: string }
	if (!tokenPayload.token) {
		throw new Error(`GHCR did not return a pull token for ${image}`)
	}

	for (const tag of getSortedVersionTags(tags)) {
		const manifestResponse = await fetch(
			`https://ghcr.io/v2/${image}/manifests/${tag}`,
			{
				method: `HEAD`,
				headers: {
					Accept: `application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json`,
					Authorization: `Bearer ${tokenPayload.token}`,
				},
			},
		)
		if (manifestResponse.ok) {
			return tag
		}
		if (manifestResponse.status !== 404) {
			throw new Error(
				`Unable to inspect ghcr.io/${image}:${tag}: ${manifestResponse.status}`,
			)
		}
	}

	return null
}

async function resolveTagCommit(
	repository: string,
	tag: string,
): Promise<string> {
	const remote = `https://github.com/${repository}.git`
	const peeledOutput = await $`git ls-remote ${remote} refs/tags/${tag}^{}`
		.quiet()
		.text()
	const peeledRef = peeledOutput.trim().split(/\s+/)[0]
	if (peeledRef) {
		return peeledRef
	}

	const directOutput = await $`git ls-remote ${remote} refs/tags/${tag}`
		.quiet()
		.text()
	const directRef = directOutput.trim().split(/\s+/)[0]
	if (!directRef) {
		throw new Error(`Unable to resolve ${repository}@${tag}`)
	}

	return directRef
}

function parseVersion(value: string): ParsedVersion | null {
	const normalized = normalizeVersion(value)
	const match =
		/^(?<major>\d+)(?:\.(?<minor>\d+))?(?:\.(?<patch>\d+))?(?:-(?<prerelease>[0-9A-Za-z.-]+))?$/.exec(
			normalized,
		)

	if (!match?.groups) {
		return null
	}

	const segments = normalized.split(`-`)[0]?.split(`.`).length ?? 0

	return {
		major: Number(match.groups[`major`]),
		minor: Number(match.groups[`minor`] ?? 0),
		patch: Number(match.groups[`patch`] ?? 0),
		prerelease: match.groups[`prerelease`] ?? null,
		segments,
	}
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
	if (left.major !== right.major) {
		return left.major - right.major
	}
	if (left.minor !== right.minor) {
		return left.minor - right.minor
	}
	if (left.patch !== right.patch) {
		return left.patch - right.patch
	}
	if (left.prerelease === null && right.prerelease !== null) {
		return 1
	}
	if (left.prerelease !== null && right.prerelease === null) {
		return -1
	}
	if (left.prerelease !== right.prerelease) {
		return (left.prerelease ?? ``).localeCompare(right.prerelease ?? ``)
	}
	return left.segments - right.segments
}

function normalizeVersion(value: string): string {
	return value.trim().replace(/^v/, ``)
}

function withVersionPrefix(value: string): string {
	return value.startsWith(`v`) ? value : `v${value}`
}

function shortSha(value: string): string {
	return SHA_PATTERN.test(value) ? value.slice(0, 8) : value
}

function groupKey(actionName: string, version: string): string {
	return `${actionName}@@${version}`
}

function findActionInputVersionUse(
	filePath: string,
	fileLines: string[],
	actionLineIndex: number,
	config: ActionInputVersionConfig,
): ActionInputVersionUse | null {
	const actionLine = fileLines[actionLineIndex]
	if (!actionLine) {
		return null
	}

	const actionIndent = leadingWhitespace(actionLine).length

	for (
		let lineIndex = actionLineIndex + 1;
		lineIndex < fileLines.length;
		lineIndex += 1
	) {
		const line = fileLines[lineIndex] ?? ``
		const trimmedLine = line.trim()

		if (trimmedLine.length === 0) {
			continue
		}

		const currentIndent = leadingWhitespace(line).length
		if (currentIndent < actionIndent) {
			return null
		}

		const versionPattern = new RegExp(
			`^(?<prefix>\\s*${escapeRegExp(config.inputName)}:\\s+)(?<version>\\d+\\.\\d+\\.\\d+)\\s*$`,
		)
		const versionMatch = versionPattern.exec(line)

		if (versionMatch?.groups) {
			const prefix = versionMatch.groups[`prefix`]
			if (!prefix) {
				return null
			}
			const currentVersion = versionMatch.groups[`version`]
			if (!currentVersion) {
				return null
			}
			return {
				filePath,
				lineIndex,
				prefix,
				depName: config.depName,
				repository: config.repository,
				containerImage: config.containerImage ?? null,
				currentVersion,
			}
		}
	}

	return null
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
}

function leadingWhitespace(value: string): string {
	return value.match(/^\s*/)?.[0] ?? ``
}

function colorWhite(value: string): string {
	return colorize(ANSI.white, value)
}

function colorGreen(value: string): string {
	return colorize(ANSI.green, value)
}

function colorCyan(value: string): string {
	return colorize(ANSI.cyan, value)
}

function colorize(color: string, value: string): string {
	if (process.env[`NO_COLOR`]) {
		return value
	}

	return `${color}${value}${ANSI.reset}`
}

await main()
