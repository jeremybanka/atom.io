# Public Audit Results

Checklist convention: `- [x]` means Decision Made.

**1. Baggage**
These look like implementation details with little consumer-facing value.

- [ ] Internal store layout is asserted directly in public tests:
  - [ ] [disposal.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/disposal.test.ts:55) resolved; formerly `55-56`, `89-99`, `155-158`, `183-186`, `210-212`
  - [ ] [transaction.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/transaction.test.ts:144) `144-149`, `374-376`, `399-401`
  - [ ] [timeline.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/timeline.test.ts:132) `132-138`, `258`, `293-320`, `377-392`, `412-420`
  - [ ] [join.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/join.test.ts:217) `217`

- [ ] `Internal.Future` is promised as the concrete async wrapper:
      [async-state.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/async-state.test.ts:34) `34`, `53`, `211`, `241`, `271`, `339-343`, `347-350`, `355-357`, `363-364`, `371`, `376-380`

- [ ] Internal relation/token names are frozen:
      [join.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/join.test.ts:331) `331-333`
      [validators.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/validators.test.ts:40) `40-46`, `53-56`

- [ ] Transceiver wire encodings are frozen byte-for-byte/string-for-string:
      [u-list.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/u-list.test.ts:38) `38`, `45`, `51`, `57-80`
      [o-list.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/o-list.test.ts:41) `41-46`, `54-70`, `84-276`
      [set-rtx.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/set-rtx.test.ts:37) `37`, `191-227`, `236-244`, `250`
      [mutable-atom.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/mutable-atom.test.ts:66) `66-68`, `106-108`

- [ ] Internal mutable JSON/update tokens are used as public contract:
      [mutable-atom.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/mutable-atom.test.ts:49) `49-68`, `75-108`, `136-151`

- [ ] Exact log icons/messages are frozen:
      [disposal.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/disposal.test.ts:38) `38-45`, `129-136`
      [mutable-atom.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/mutable-atom.test.ts:302) `302-309`
      [o-list-atom.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/o-list-atom.test.ts:253) `253-259`
      [logger.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/logger.test.ts:112) `112-141`

- [ ] ESLint rule `messageId`s are asserted, which are test implementation details rather than user-visible rule behavior:
      [exact-catch-types.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/eslint-plugin/exact-catch-types.test.ts:117) `117`, `127`, `137`, `148`, `162`
      [explicit-state-types.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/eslint-plugin/explicit-state-types.test.ts:126) `126`, `137`, `148`, `158`, `168`, `178`

**2. Risk**
These may be real behavior, but they are expensive promises.

- [ ] Public transaction subscription payload is frozen down to sub-event order, redacted fields, `epoch: Number.NaN`, and intermediate selector updates:
      [transaction.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/transaction.test.ts:203) `203-244`

- [ ] Transaction boundaries are asserted through exact `subEvents` membership:
      [transaction.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/transaction.test.ts:336) `336-346`

- [ ] Selector evaluation/subscription invalidation counts are frozen:
      [atom-selector.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/atom-selector.test.ts:223) `223`, `227`, `233`, `240`
      [atom-selector.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/atom-selector.test.ts:301) `301`, `305`, `308`, `311`

- [ ] Timeline cursor/history behavior is asserted as exact `at`/`length` values, including erasing future history:
      [react-hooks.test.tsx](/home/jem/atom.io/packages/atom.io/__tests__/public/react-hooks.test.tsx:202) `202-226`, `238-247`, `351-366`

- [ ] `Silo` promises not to create the implicit store and promises exact thrown message text:
      [silo.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/silo.test.ts:57) `57-59`

- [ ] `Silo.install` failure during transactions is promised as logger counts:
      [silo-install.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/silo-install.test.ts:68) `68-73`

**3. Suspicious**
I can see these either way, but they deserve a product/API decision.

- [ ] `useI` setter identity is promised stable across rerender, while also indirectly pinning render count:
      [react-hooks.test.tsx](/home/jem/atom.io/packages/atom.io/__tests__/public/react-hooks.test.tsx:78) `78-79`, `122-123`

- [ ] `useLoadable` referential identity/render churn is frozen. The inline comment even says there is no settled opinion yet:
      [react-hooks.test.tsx](/home/jem/atom.io/packages/atom.io/__tests__/public/react-hooks.test.tsx:799) `799`, `807`, `817`, `825`, `833`

- [ ] Join relation ordering is promised for many-to-many replacements:
      [join.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/join.test.ts:273) `273-288`

- [ ] `SetRTX` rollback/de-sequenced protocol behavior is public-tested at a very low level:
      [set-rtx.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/set-rtx.test.ts:66) `66-72`, `107-178`, `195-227`

- [ ] `OList`/`UList` `packUpdate` + `do`/`undo` objects are public-tested broadly. Maybe that is intended for realtime protocol users, but if not, it is a large accidental surface:
      [u-list.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/u-list.test.ts:96) `96-156`
      [o-list.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/o-list.test.ts:290) `290-579`
