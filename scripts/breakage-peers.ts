import { fileURLToPath } from "node:url"

import { createReleaseIntent } from "./breakage-release.ts"

export { certifyBreaking } from "./breakage-release.ts"

export const releaseIntent = createReleaseIntent(
	fileURLToPath(new URL(`../`, import.meta.url)),
)
