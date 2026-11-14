---
"@atom.io/spa-devtools": patch
---

Count application nodes separately from filtered debugger records during ecology capture, so the supported 10,000-instance snapshot remains complete with debugger metadata present. Keep total state inspections bounded at the node allowance plus 1,000 records, preserve zero-work requests and report genuine node or inspection-budget truncation explicitly.
