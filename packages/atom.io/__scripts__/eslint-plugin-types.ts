import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import type { Rolldown } from "tsdown"

/** Inline rule declarations while retaining the consumer's parser type identities. */
export function eslintPluginTypes(): Rolldown.Plugin {
	const require = createRequire(import.meta.url)
	const utilsEntry = require.resolve(`@typescript-eslint/utils`)
	const directory = dirname(utilsEntry)
	const { AST_NODE_TYPES } = createRequire(utilsEntry)(
		`@typescript-eslint/types`,
	) as {
		AST_NODE_TYPES: Record<string, string>
	}
	return {
		name: `atom.io-eslint-rule-types`,
		load(id) {
			// Copying scope classes would give their private members different identities.
			if (id === join(directory, `ts-eslint/Scope.d.ts`)) {
				return `
import type { parseForESLint, parse } from "@typescript-eslint/parser";
export declare namespace Scope {
  type ScopeManager = ReturnType<typeof parseForESLint>["scopeManager"];
  type Scope = ScopeManager["scopes"][number];
  type ParserVariable = Scope["variables"][number];
  // ESLint may also inject globals without the parser's type/value flags.
  interface ESLintScopeVariable extends Omit<ParserVariable, "isTypeVariable" | "isValueVariable"> {
    writeable?: boolean;
    eslintExplicitGlobal?: boolean;
    eslintImplicitGlobalSetting?: "readonly" | "writable";
    eslintExplicitGlobalComments?: ReturnType<typeof parse>["comments"];
  }
  type Variable = ParserVariable | ESLintScopeVariable;
}`
			}
			if (id === join(directory, `ts-eslint/ParserOptions.d.ts`)) {
				return `
import type { ParserOptions } from "@typescript-eslint/parser";
export type { ParserOptions };
export type DebugLevel = NonNullable<ParserOptions["debugLevel"]>;
export type EcmaVersion = ParserOptions["ecmaVersion"];
export type SourceType = NonNullable<ParserOptions["sourceType"]>;`
			}
			if (id === join(directory, `ts-estree.d.ts`)) {
				// Derive nodes and tokens from the declared parser peer instead of copying
				// its AST declarations, enums, and module augmentations into atom.io.
				return `
import type { parse, ParserServices } from "@typescript-eslint/parser";
export type { ParserServices, ParserServicesWithTypeInformation, ParserServicesWithoutTypeInformation } from "@typescript-eslint/parser";
type ParserNode = Parameters<ParserServices["esTreeNodeToTSNodeMap"]["get"]>[0];
export type AST_NODE_TYPES = ParserNode["type"];
export type AST_TOKEN_TYPES = ReturnType<typeof parse>["tokens"][number]["type"];
export declare namespace TSESTree {
  type Node = ParserNode;
  type Token = ReturnType<typeof parse>["tokens"][number];
  type Comment = ReturnType<typeof parse>["comments"][number];
  type SourceLocation = ParserNode["loc"];
  type Position = SourceLocation["start"];
  type Range = ParserNode["range"];
  interface NodeOrTokenData { type: string; loc: SourceLocation; range: Range; }
  ${Object.values(AST_NODE_TYPES)
		.map((name) => `type ${name} = Extract<ParserNode, { type: "${name}" }>;`)
		.join(`\n  `)}
}`
			}
		},
	}
}
