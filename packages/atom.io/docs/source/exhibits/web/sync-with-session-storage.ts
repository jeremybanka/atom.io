import { storageSync } from "atom.io/web"

// DOCS REVIEW: This is a fragment rather than a complete atom declaration.
// Should the generated example remain copy-pasteable like the localStorage one?
effects: [storageSync(sessionStorage, JSON, `sidebarOpen`)]
