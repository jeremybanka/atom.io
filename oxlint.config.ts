import { defineConfig, type OxlintConfig } from "oxlint"

import atomIoConfig from "./packages/atom.io/oxlint.json" with { type: "json" }
import { LINT_IGNORES } from "./scripts/lint-common.ts"

const config: OxlintConfig = defineConfig({
	extends: [atomIoConfig as OxlintConfig],
	ignorePatterns: LINT_IGNORES,
})

export default config
