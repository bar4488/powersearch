# TODO

Priority scale:

- `P0`: must-have for the next usable version.
- `P1`: important correctness or workflow fix.
- `P2`: quality, maintainability, or polish.
- `P3`: lower-priority cleanup or later hardening.

## P0 - Must-Haves

## P1 - Important Bug Fixes

- [ ] `[P1]` Improve preview labels for long references, multiline references, and deleted/broken files.

## P2 - Design And Maintainability

- [ ] `[P2]` Add a strategy for stale ranges.
  - Stored `Range`s drift as files are edited.
- [ ] `[P2]` Add confirmation before deleting folders with children.
- [ ] `[P2]` Add CI for `npm run compile`, `npm run lint`, and behavior tests.
- [ ] `[P2]` Replace the generated sample test with real behavior tests.
  - Cover activation, commands, sharded persistence, deletion, color changes, visibility, missing files, and drag/drop.

## P3 - Later Improvements

- [ ] `[P3]` Address dependency hygiene.
  - `npm ci` reported 17 audit vulnerabilities.
- [ ] `[P3]` Consider configurable default colors and decoration style.
- [ ] `[P3]` Enable stricter TypeScript checks incrementally, starting with null-safety.
  - Not important for now, but useful once the behavior is more stable.

## Fixed

- [x] ~~Fix activation crash when no editor is open: `src/extension.ts`.~~ Fixed by removing the unused `activeTextEditor.document.uri` access during activation.
- [x] ~~Guard editor commands against no active editor, no selection, no word range, or missing reference-provider result: `src/tree_controller.ts`.~~ Fixed with early returns and user messages for symbol, selection, and line commands.
- [x] ~~Make `removeData` clear the in-memory tree and active decorations, not only `workspaceState`.~~ Fixed by adding `FoldersTreeDataProvider.clear()` and calling it before deleting persisted data.
- [x] ~~Fix `setFolderColor(undefined)` so choosing `None` persists and refreshes the view.~~ Fixed by always updating the tree after clearing a folder color.
- [x] ~~Prevent drag/drop from creating cycles by dropping a folder into its own descendant.~~ Fixed by rejecting drops where the target is inside one of the moved nodes.
- [x] ~~Handle deleted or missing referenced files when rendering tree items instead of letting `openTextDocument` fail.~~ Fixed by catching document-open failures and rendering a "Missing reference" item.
- [x] ~~Fix `dispose()` calling `_listener.dispose()` even though `_listener` is never initialized.~~ Fixed by removing the unused `_listener` field and disposal call.
- [x] ~~Store all persistent PowerSearch state in a `.powersearch` folder in the workspace, not in VS Code hidden local storage / `workspaceState`.~~ Fixed by adding sharded `.powersearch` storage, legacy migration, and a documented schema.
- [x] ~~Add confirmation before clearing all data.~~ Fixed by requiring a modal confirmation before deleting `.powersearch`.
- [x] ~~Persist visibility and expansion state.~~ Fixed by serializing folder `isHidden` and `expanded`, and by saving tree-view expand/collapse events.
- [x] ~~Persist selected folder or visibly indicate the current target folder for new references.~~ Fixed by serializing `selectedFolderId` in `.powersearch/ui.json`.
- [x] ~~Replace one large state file with a sharded format for large range counts.~~ Fixed with `manifest.json`, `folders.json`, `ui.json`, `indexes/files.json`, and per-file range shards.
- [x] ~~Remove absolute paths from current-format persistent data.~~ Fixed by storing locations as workspace-folder name plus relative source path.
- [x] ~~Keep the tree limited to folders; store ranges outside the tree.~~ Fixed by moving ranges into range shards keyed by `folderId`.
- [x] ~~Use warning messages for failed command preconditions.~~ Fixed for active-editor, selection, symbol, and reference-provider failures.
- [x] ~~Remove or implement contributed commands that are not registered: `powersearch.addSearchResults`, `powersearch.recolor`.~~ Fixed by removing obsolete contributions.
- [x] ~~Fix `powersearch.selectFolder` metadata.~~ Fixed by removing the internal command from contributed command-palette metadata.
- [x] ~~Fix color validation.~~ Fixed by anchoring the regex and accepting uppercase hex.
- [x] ~~Avoid in-place sorting of `references` in `getChildren`, which mutates persisted order.~~ Fixed by removing range/reference nodes from the tree and returning folder children in stored order.
- [x] ~~Separate runtime tree objects from persisted data.~~ Fixed with versioned folder, UI, index, and range-shard files.
- [x] ~~Rework decoration lifecycle management.~~ Fixed by moving decoration ownership into `DecorationManager`.
- [x] ~~Avoid opening documents during `getTreeItem` rendering.~~ Fixed because tree items are folders only.
- [x] ~~Fix misleading command labels such as "Toggle Visibility Hide" vs "Toggle Visibility".~~ Fixed by renaming them to "Hide Folder" and "Show Folder".
- [x] ~~Simplify the current target-folder workflow.~~ Fixed with an explicit target folder, status-bar visibility, quick target switching, and no silent default-folder creation for line/selection coloring.
- [x] ~~Improve root-level folder actions.~~ Fixed by moving root actions to reliable tree title and welcome affordances instead of depending on empty-space context behavior.
- [x] ~~Refresh the folder tree visuals.~~ Fixed with custom folder icons plus clearer target and inherited-color badges/tooltips.
- [x] ~~Add inherited folder colors.~~ Fixed with a `Parent` color mode, resolved ancestor-color handling in decorations, and persisted `inheritsColor` folder metadata.
- [x] ~~Add per-folder Markdown docs.~~ Fixed with deterministic `.powersearch/docs/<folder-id>.md` notes and cleanup on folder deletion.
- [x] ~~Replace the README template with actual usage, limitations, and command documentation.~~ Fixed by documenting the current folder/tree/search workflow in `README.md`.
- [x] ~~Document the new target-folder workflow, inherited colors, root actions, and folder docs.~~ Fixed by updating `README.md` and `docs/powersearch-state-format.md`.
- [x] ~~Add a search workflow with save-results flows.~~ Fixed with a dedicated Search view and inline search/result actions.
