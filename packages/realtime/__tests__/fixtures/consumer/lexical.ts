import assert from "node:assert/strict"

import { MosaicLexicalTextEditor } from "@atom.io/realtime/react/lexical"
import { multiClient } from "@atom.io/realtime/testing/react"

assert.equal(typeof MosaicLexicalTextEditor, `function`)
assert.equal(typeof multiClient, `function`)
