# PowerSearch – Code Review Tasks

## Redundant / Dead Code

- [x] **R1** `src/tree/tree_parser.ts` — entire file is unused (`parseTree`, `dumpTree` have no callers; `storage.ts` has equivalent `serializeFolder`/`deserializeFolder`). Delete the file.
- [x] **R2** `src/utils.ts` — `positionFrom()` is exported but has no callers anywhere. Remove it.
- [x] **R3** `src/tree/tree.ts` — `updateNode(folder)` ignores its `folder` parameter and only calls `updateTree()`. Remove the unused parameter.
- [x] **R4** `src/tree_controller.ts` — `findMatchesInCurrentFile` is declared `async` but contains no `await`. Remove the keyword.
- [x] **R5** `src/utils.ts` — `indicesToNode` uses `var` inside a `for…of` loop (function-scoped, leaks). Change to `const`.
- [x] **R6** `src/storage.ts` — `searchRootExpanded` is read from `ui.json` and included in `LoadedPowerSearchState` but is never consumed by any caller and is never written back by `saveUi`. Remove it from the interface, load, and save code.

## Bugs

- [x] **B1** `src/utils.ts` — `resolveFolderColor`: walk condition `!current.inheritsColor && current.color` skips non-inheriting parents that have no color, stealing a grandparent's color instead of returning `undefined`. Should be `if (!current.inheritsColor) { return current.color; }`.
- [x] **B2** `src/tree/tree.ts` — `setExpanded` for `foldersRoot` calls `this.refresh()` instead of `this.updateTree()`, so the expanded state is never persisted to `ui.json` and resets on every reload.
- [x] **B3** `src/tree_controller.ts` — `onChangeFolderColor`: when the user presses Escape on the custom-color input box, `showInputBox` returns `undefined`, which falls through to `isValidColor` and shows the misleading "Invalid color format." warning. Add an early return for `undefined`.
- [x] **B4** `src/utils.ts` — `isValidColor` accepts the `0x` prefix (`0x[a-fA-F0-9]{6}`), which is not a valid CSS color. The regex should only allow `#`.
- [x] **B5** `src/tree/tree.ts` — `dragMimeTypes = []` is always empty, but `handleDrag` produces `FOLDER_MIME` and `REFERENCE_MIME`. VS Code uses this array to announce what a drag produces; an empty list breaks drag feedback and may suppress drops. Set it to `[FOLDER_MIME, REFERENCE_MIME]`.
- [x] **B6** `src/search_view.ts` — `getNonce()` uses `Math.random()` (non-cryptographic) to generate a CSP nonce. Use `crypto.randomBytes` instead.
