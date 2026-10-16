import type { parse, ParserServices } from "@typescript-eslint/parser"

export type {
	ParserServices,
	ParserServicesWithoutTypeInformation,
	ParserServicesWithTypeInformation,
} from "@typescript-eslint/parser"

type ParserNode = Parameters<ParserServices[`esTreeNodeToTSNodeMap`][`get`]>[0]
type NodeOf<Type extends string> = Extract<ParserNode, { type: Type }>
export type AST_NODE_TYPES = ParserNode[`type`]
export type AST_TOKEN_TYPES = ReturnType<typeof parse>[`tokens`][number][`type`]

// Keep node and token identities tied to the consumer's parser. Copying upstream
// AST declarations makes the named rules incompatible with its RuleTester.
export declare namespace TSESTree {
	type Node = ParserNode
	type Token = ReturnType<typeof parse>[`tokens`][number]
	type Comment = ReturnType<typeof parse>[`comments`][number]
	type SourceLocation = ParserNode[`loc`]
	type Position = SourceLocation[`start`]
	type Range = ParserNode[`range`]
	interface NodeOrTokenData {
		type: string
		loc: SourceLocation
		range: Range
	}

	type AccessorProperty = NodeOf<`AccessorProperty`>
	type ArrayExpression = NodeOf<`ArrayExpression`>
	type ArrayPattern = NodeOf<`ArrayPattern`>
	type ArrowFunctionExpression = NodeOf<`ArrowFunctionExpression`>
	type AssignmentExpression = NodeOf<`AssignmentExpression`>
	type AssignmentPattern = NodeOf<`AssignmentPattern`>
	type AwaitExpression = NodeOf<`AwaitExpression`>
	type BinaryExpression = NodeOf<`BinaryExpression`>
	type BlockStatement = NodeOf<`BlockStatement`>
	type BreakStatement = NodeOf<`BreakStatement`>
	type CallExpression = NodeOf<`CallExpression`>
	type CatchClause = NodeOf<`CatchClause`>
	type ChainExpression = NodeOf<`ChainExpression`>
	type ClassBody = NodeOf<`ClassBody`>
	type ClassDeclaration = NodeOf<`ClassDeclaration`>
	type ClassExpression = NodeOf<`ClassExpression`>
	type ConditionalExpression = NodeOf<`ConditionalExpression`>
	type ContinueStatement = NodeOf<`ContinueStatement`>
	type DebuggerStatement = NodeOf<`DebuggerStatement`>
	type Decorator = NodeOf<`Decorator`>
	type DoWhileStatement = NodeOf<`DoWhileStatement`>
	type EmptyStatement = NodeOf<`EmptyStatement`>
	type ExportAllDeclaration = NodeOf<`ExportAllDeclaration`>
	type ExportDefaultDeclaration = NodeOf<`ExportDefaultDeclaration`>
	type ExportNamedDeclaration = NodeOf<`ExportNamedDeclaration`>
	type ExportSpecifier = NodeOf<`ExportSpecifier`>
	type ExpressionStatement = NodeOf<`ExpressionStatement`>
	type ForInStatement = NodeOf<`ForInStatement`>
	type ForOfStatement = NodeOf<`ForOfStatement`>
	type ForStatement = NodeOf<`ForStatement`>
	type FunctionDeclaration = NodeOf<`FunctionDeclaration`>
	type FunctionExpression = NodeOf<`FunctionExpression`>
	type Identifier = NodeOf<`Identifier`>
	type IfStatement = NodeOf<`IfStatement`>
	type ImportAttribute = NodeOf<`ImportAttribute`>
	type ImportDeclaration = NodeOf<`ImportDeclaration`>
	type ImportDefaultSpecifier = NodeOf<`ImportDefaultSpecifier`>
	type ImportExpression = NodeOf<`ImportExpression`>
	type ImportNamespaceSpecifier = NodeOf<`ImportNamespaceSpecifier`>
	type ImportSpecifier = NodeOf<`ImportSpecifier`>
	type JSXAttribute = NodeOf<`JSXAttribute`>
	type JSXClosingElement = NodeOf<`JSXClosingElement`>
	type JSXClosingFragment = NodeOf<`JSXClosingFragment`>
	type JSXElement = NodeOf<`JSXElement`>
	type JSXEmptyExpression = NodeOf<`JSXEmptyExpression`>
	type JSXExpressionContainer = NodeOf<`JSXExpressionContainer`>
	type JSXFragment = NodeOf<`JSXFragment`>
	type JSXIdentifier = NodeOf<`JSXIdentifier`>
	type JSXMemberExpression = NodeOf<`JSXMemberExpression`>
	type JSXNamespacedName = NodeOf<`JSXNamespacedName`>
	type JSXOpeningElement = NodeOf<`JSXOpeningElement`>
	type JSXOpeningFragment = NodeOf<`JSXOpeningFragment`>
	type JSXSpreadAttribute = NodeOf<`JSXSpreadAttribute`>
	type JSXSpreadChild = NodeOf<`JSXSpreadChild`>
	type JSXText = NodeOf<`JSXText`>
	type LabeledStatement = NodeOf<`LabeledStatement`>
	type Literal = NodeOf<`Literal`>
	type LogicalExpression = NodeOf<`LogicalExpression`>
	type MemberExpression = NodeOf<`MemberExpression`>
	type MetaProperty = NodeOf<`MetaProperty`>
	type MethodDefinition = NodeOf<`MethodDefinition`>
	type NewExpression = NodeOf<`NewExpression`>
	type ObjectExpression = NodeOf<`ObjectExpression`>
	type ObjectPattern = NodeOf<`ObjectPattern`>
	type PrivateIdentifier = NodeOf<`PrivateIdentifier`>
	type Program = NodeOf<`Program`>
	type Property = NodeOf<`Property`>
	type PropertyDefinition = NodeOf<`PropertyDefinition`>
	type RestElement = NodeOf<`RestElement`>
	type ReturnStatement = NodeOf<`ReturnStatement`>
	type SequenceExpression = NodeOf<`SequenceExpression`>
	type SpreadElement = NodeOf<`SpreadElement`>
	type StaticBlock = NodeOf<`StaticBlock`>
	type Super = NodeOf<`Super`>
	type SwitchCase = NodeOf<`SwitchCase`>
	type SwitchStatement = NodeOf<`SwitchStatement`>
	type TaggedTemplateExpression = NodeOf<`TaggedTemplateExpression`>
	type TemplateElement = NodeOf<`TemplateElement`>
	type TemplateLiteral = NodeOf<`TemplateLiteral`>
	type ThisExpression = NodeOf<`ThisExpression`>
	type ThrowStatement = NodeOf<`ThrowStatement`>
	type TryStatement = NodeOf<`TryStatement`>
	type UnaryExpression = NodeOf<`UnaryExpression`>
	type UpdateExpression = NodeOf<`UpdateExpression`>
	type VariableDeclaration = NodeOf<`VariableDeclaration`>
	type VariableDeclarator = NodeOf<`VariableDeclarator`>
	type WhileStatement = NodeOf<`WhileStatement`>
	type WithStatement = NodeOf<`WithStatement`>
	type YieldExpression = NodeOf<`YieldExpression`>
	type TSAbstractAccessorProperty = NodeOf<`TSAbstractAccessorProperty`>
	type TSAbstractKeyword = NodeOf<`TSAbstractKeyword`>
	type TSAbstractMethodDefinition = NodeOf<`TSAbstractMethodDefinition`>
	type TSAbstractPropertyDefinition = NodeOf<`TSAbstractPropertyDefinition`>
	type TSAnyKeyword = NodeOf<`TSAnyKeyword`>
	type TSArrayType = NodeOf<`TSArrayType`>
	type TSAsExpression = NodeOf<`TSAsExpression`>
	type TSAsyncKeyword = NodeOf<`TSAsyncKeyword`>
	type TSBigIntKeyword = NodeOf<`TSBigIntKeyword`>
	type TSBooleanKeyword = NodeOf<`TSBooleanKeyword`>
	type TSCallSignatureDeclaration = NodeOf<`TSCallSignatureDeclaration`>
	type TSClassImplements = NodeOf<`TSClassImplements`>
	type TSConditionalType = NodeOf<`TSConditionalType`>
	type TSConstructorType = NodeOf<`TSConstructorType`>
	type TSConstructSignatureDeclaration =
		NodeOf<`TSConstructSignatureDeclaration`>
	type TSDeclareFunction = NodeOf<`TSDeclareFunction`>
	type TSDeclareKeyword = NodeOf<`TSDeclareKeyword`>
	type TSEmptyBodyFunctionExpression = NodeOf<`TSEmptyBodyFunctionExpression`>
	type TSEnumBody = NodeOf<`TSEnumBody`>
	type TSEnumDeclaration = NodeOf<`TSEnumDeclaration`>
	type TSEnumMember = NodeOf<`TSEnumMember`>
	type TSExportAssignment = NodeOf<`TSExportAssignment`>
	type TSExportKeyword = NodeOf<`TSExportKeyword`>
	type TSExternalModuleReference = NodeOf<`TSExternalModuleReference`>
	type TSFunctionType = NodeOf<`TSFunctionType`>
	type TSImportEqualsDeclaration = NodeOf<`TSImportEqualsDeclaration`>
	type TSImportType = NodeOf<`TSImportType`>
	type TSIndexedAccessType = NodeOf<`TSIndexedAccessType`>
	type TSIndexSignature = NodeOf<`TSIndexSignature`>
	type TSInferType = NodeOf<`TSInferType`>
	type TSInstantiationExpression = NodeOf<`TSInstantiationExpression`>
	type TSInterfaceBody = NodeOf<`TSInterfaceBody`>
	type TSInterfaceDeclaration = NodeOf<`TSInterfaceDeclaration`>
	type TSInterfaceHeritage = NodeOf<`TSInterfaceHeritage`>
	type TSIntersectionType = NodeOf<`TSIntersectionType`>
	type TSIntrinsicKeyword = NodeOf<`TSIntrinsicKeyword`>
	type TSLiteralType = NodeOf<`TSLiteralType`>
	type TSMappedType = NodeOf<`TSMappedType`>
	type TSMethodSignature = NodeOf<`TSMethodSignature`>
	type TSModuleBlock = NodeOf<`TSModuleBlock`>
	type TSModuleDeclaration = NodeOf<`TSModuleDeclaration`>
	type TSNamedTupleMember = NodeOf<`TSNamedTupleMember`>
	type TSNamespaceExportDeclaration = NodeOf<`TSNamespaceExportDeclaration`>
	type TSNeverKeyword = NodeOf<`TSNeverKeyword`>
	type TSNonNullExpression = NodeOf<`TSNonNullExpression`>
	type TSNullKeyword = NodeOf<`TSNullKeyword`>
	type TSNumberKeyword = NodeOf<`TSNumberKeyword`>
	type TSObjectKeyword = NodeOf<`TSObjectKeyword`>
	type TSOptionalType = NodeOf<`TSOptionalType`>
	type TSParameterProperty = NodeOf<`TSParameterProperty`>
	type TSPrivateKeyword = NodeOf<`TSPrivateKeyword`>
	type TSPropertySignature = NodeOf<`TSPropertySignature`>
	type TSProtectedKeyword = NodeOf<`TSProtectedKeyword`>
	type TSPublicKeyword = NodeOf<`TSPublicKeyword`>
	type TSQualifiedName = NodeOf<`TSQualifiedName`>
	type TSReadonlyKeyword = NodeOf<`TSReadonlyKeyword`>
	type TSRestType = NodeOf<`TSRestType`>
	type TSSatisfiesExpression = NodeOf<`TSSatisfiesExpression`>
	type TSStaticKeyword = NodeOf<`TSStaticKeyword`>
	type TSStringKeyword = NodeOf<`TSStringKeyword`>
	type TSSymbolKeyword = NodeOf<`TSSymbolKeyword`>
	type TSTemplateLiteralType = NodeOf<`TSTemplateLiteralType`>
	type TSThisType = NodeOf<`TSThisType`>
	type TSTupleType = NodeOf<`TSTupleType`>
	type TSTypeAliasDeclaration = NodeOf<`TSTypeAliasDeclaration`>
	type TSTypeAnnotation = NodeOf<`TSTypeAnnotation`>
	type TSTypeAssertion = NodeOf<`TSTypeAssertion`>
	type TSTypeLiteral = NodeOf<`TSTypeLiteral`>
	type TSTypeOperator = NodeOf<`TSTypeOperator`>
	type TSTypeParameter = NodeOf<`TSTypeParameter`>
	type TSTypeParameterDeclaration = NodeOf<`TSTypeParameterDeclaration`>
	type TSTypeParameterInstantiation = NodeOf<`TSTypeParameterInstantiation`>
	type TSTypePredicate = NodeOf<`TSTypePredicate`>
	type TSTypeQuery = NodeOf<`TSTypeQuery`>
	type TSTypeReference = NodeOf<`TSTypeReference`>
	type TSUndefinedKeyword = NodeOf<`TSUndefinedKeyword`>
	type TSUnionType = NodeOf<`TSUnionType`>
	type TSUnknownKeyword = NodeOf<`TSUnknownKeyword`>
	type TSVoidKeyword = NodeOf<`TSVoidKeyword`>
}
