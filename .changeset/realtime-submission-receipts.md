---
"@atom.io/realtime": minor
"atom.io": patch
"@atom.io/template-preact-svg-editor": patch
---

Return stable per-submission receipts from Mosaic Domain batch clients, expose transaction-to-batch correlation and React status hooks, and distinguish authoritative acceptance/rejection from offline or interrupted outcomes. Existing callers may continue to await and discard `submit` results; explicit `Promise<void>` wrappers must discard the returned receipt or adopt the new return type. Server validation and client protocol failures retain detailed errors in logs while exposing safe public reasons. Document queued optimism, recovery, rejection retry, and receipt ownership.

Use the contour edit’s own submission receipt when reporting rejection, so another edit or accepted broadcast cannot overwrite its outcome.
