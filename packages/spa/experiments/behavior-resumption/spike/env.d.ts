// Minimal compile-time environment for source-bundling the PR without @types/node.
// Browser production builds replace process.env.NODE_ENV with a constant.
declare var process: { env: Record<string, string | undefined> } | undefined
