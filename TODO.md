# TODO

Priority scale:

- `P0`: must-have for the next usable version.
- `P1`: important correctness or workflow fix.
- `P2`: quality, maintainability, or polish.
- `P3`: lower-priority cleanup or later hardening.

## P0 - Must-Haves

- [ ] `[P0]` Allow references at the root level.
  - Remove code and TODO language that assumes root can contain only folders.
  - Make save/load, drag/drop, selection, deletion, and decoration handling work for root references.
- [ ] `[P0]` Support color selection for root-level references.
  - Add a right-click action at the root or an equivalent root-level color target.
  - Root references need a decoration color even when they are not inside a folder.
- [ ] `[P0]` Mark missing referenced files as broken, but do not remove them implicitly.
  - Broken references should remain visible and identifiable in the tree.
  - Cleanup should be explicit, not automatic.
- [ ] `[P0]` Replace the generated sample test with real behavior tests.
  - Cover activation, commands, persistence, deletion, color changes, visibility, root references, missing files, and drag/drop.

## P1 - Important Bug Fixes

- [ ] `[P1]` Use warning messages for failed command preconditions.
  - Examples: no active editor, no selected text, no symbol under cursor, no reference-provider result.
  - Keep informational messages for successful or neutral informational states.
- [ ] `[P1]` Remove or implement contributed commands that are not registered: `powersearch.addSearchResults`, `powersearch.recolor`.
- [ ] `[P1]` Fix `powersearch.selectFolder` metadata.
  - It is currently titled "Remove Folder" with a bin icon.
- [ ] `[P1]` Fix color validation.
  - Current regex rejects uppercase hex and is not anchored.
- [ ] `[P1]` Avoid in-place sorting of `references` in `getChildren`, which mutates persisted order.
- [ ] `[P1]` Improve preview labels for long references, multiline references, and deleted/broken files.

## P2 - Design And Maintainability

- [ ] `[P2]` Separate runtime tree objects from persisted data.
  - Add a versioned persisted schema so loading and saving are safer.
  - This should align with the new `.powersearch` workspace-folder storage.
- [ ] `[P2]` Strengthen root/folder/reference invariants in the type model.
  - Root references should be first-class if supported.
  - Avoid casts that hide invalid tree states.
- [ ] `[P2]` Rework decoration lifecycle management.
  - Current decoration state lives directly on folder objects and needs a better design.
- [ ] `[P2]` Avoid opening documents during `getTreeItem` rendering, or add caching/error handling for large or stale trees.
- [ ] `[P2]` Add a strategy for stale ranges.
  - Stored `Range`s drift as files are edited.
- [ ] `[P2]` Add confirmation before deleting folders with children.
- [ ] `[P2]` Replace the README template with actual usage, limitations, and command documentation.
- [ ] `[P2]` Add CI for `npm run compile`, `npm run lint`, and behavior tests.

## P3 - Later Improvements

- [ ] `[P3]` Address dependency hygiene.
  - `npm ci` reported 17 audit vulnerabilities.
- [ ] `[P3]` Consider configurable default colors and decoration style.
- [ ] `[P3]` Enable stricter TypeScript checks incrementally, starting with null-safety.
  - Not important for now, but useful once the behavior is more stable.
- [ ] `[P3]` Remove unused imports and variables as part of nearby cleanup.
- [ ] `[P3]` Fix misleading command labels such as "Toggle Visibility Hide" vs "Toggle Visibility".

## Fixed

- [x] ~~Fix activation crash when no editor is open: `src/extension.ts`.~~ Fixed by removing the unused `activeTextEditor.document.uri` access during activation.
- [x] ~~Guard editor commands against no active editor, no selection, no word range, or missing reference-provider result: `src/tree_controller.ts`.~~ Fixed with early returns and user messages for symbol, selection, and line commands.
- [x] ~~Make `removeData` clear the in-memory tree and active decorations, not only `workspaceState`.~~ Fixed by adding `FoldersTreeDataProvider.clear()` and calling it before deleting persisted data.
- [x] ~~Fix `setFolderColor(undefined)` so choosing `None` persists and refreshes the view.~~ Fixed by always updating the tree after clearing a folder color.
- [x] ~~Prevent drag/drop from creating cycles by dropping a folder into its own descendant.~~ Fixed by rejecting drops where the target is inside one of the moved nodes.
- [x] ~~Handle deleted or missing referenced files when rendering tree items instead of letting `openTextDocument` fail.~~ Fixed by catching document-open failures and rendering a "Missing reference" item.
- [x] ~~Fix `dispose()` calling `_listener.dispose()` even though `_listener` is never initialized.~~ Fixed by removing the unused `_listener` field and disposal call.
- [x] ~~Store all persistent PowerSearch state in a `.powersearch` folder in the workspace, not in VS Code hidden local storage / `workspaceState`.~~ Fixed by adding `.powersearch/state.json` storage, legacy `workspaceState` migration, and a documented schema.
- [x] ~~Add confirmation before clearing all data.~~ Fixed by requiring a modal confirmation before deleting `.powersearch/state.json`.
- [x] ~~Persist visibility and expansion state.~~ Fixed by serializing folder `isHidden` and `expanded`, and by saving tree-view expand/collapse events.
- [x] ~~Persist selected folder or visibly indicate the current target folder for new references.~~ Fixed by serializing `selectedFolderPath` in `.powersearch/state.json`.
