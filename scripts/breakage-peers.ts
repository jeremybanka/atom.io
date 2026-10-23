import { fileURLToPath } from "node:url"

import type { NpmConfig } from "breakage"

import { createReleaseIntent } from "./breakage-release.ts"

export { certifyBreaking } from "./breakage-release.ts"

export const releaseIntent: NonNullable<NpmConfig[`releaseIntent`]> =
	createReleaseIntent(fileURLToPath(new URL(`../`, import.meta.url)))
