import type { ParserOptions } from "@typescript-eslint/parser"

export type { ParserOptions }
export type DebugLevel = NonNullable<ParserOptions[`debugLevel`]>
export type EcmaVersion = ParserOptions[`ecmaVersion`]
export type SourceType = NonNullable<ParserOptions[`sourceType`]>
