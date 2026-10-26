import type { ReleaseConfig } from "breakage"
import { semverPolicy } from "breakage"
import { changesetsReleaseDelta } from "breakage/changesets"

export const release: ReleaseConfig = {
	resolveDelta: changesetsReleaseDelta(),
	policy: semverPolicy({ beforeV1: `minor` }),
}
