---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
---

Add an optional Floating UI capability that positions HTML overlays with CSS translate and composes with Motion transforms on the same element, including automatic position updates and cleanup through retained exits. Reactive inline style changes preserve positioning and Motion values, and pending overlays stay hidden against author !important visibility rules until their first position resolves.

Refresh the debugger's generated serving-size documentation for the updated SPA runtime.
