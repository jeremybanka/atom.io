---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"atom.io": patch
---

Restore controlled input values and checked states after edits, reapply select values after option changes, and preserve numerically equivalent number-input text. Make onChange follow edits for text/range inputs and textareas, bubble onFocus/onBlur through focusin/focusout, remove null reflected attributes, and focus newly mounted autoFocus elements.
