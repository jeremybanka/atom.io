import type { ReadableToken } from "atom.io"

export * from "./attach-introspection-states.ts"
export * from "./auditor.ts"
export * from "./differ.ts"
export * from "./refinery.ts"
export * from "./sprawl.ts"

export type FamilyNode<Token extends ReadableToken<unknown, any, any>> = {
	key: string
	familyMembers: Map<string, Token>
}

export type ReadonlyTokenIndex<Token extends ReadableToken<unknown, any, any>> =
	ReadonlyMap<string, FamilyNode<Token> | Token>

export type WritableTokenIndex<Token extends ReadableToken<unknown, any, any>> =
	Map<string, FamilyNode<Token> | Token>
