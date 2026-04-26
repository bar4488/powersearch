# PowerSearch State Format

PowerSearch stores all durable data in a visible `.powersearch` folder. The format is designed for large numbers of ranges: startup loads small metadata files, folder trees load lightweight reference indexes, and full range payloads stay sharded by workspace folder and source file.

No current-format file stores absolute workspace paths or absolute source-file paths. Source locations are represented by a VS Code workspace-folder name plus a relative file path.

## Directory Layout

```text
<chosen-workspace-folder>/.powersearch/
  manifest.json
  folders.json
  ui.json
  docs/
    root.md
    <folder-id>.md
  indexes/
    files.json
    folders/
      <hash-prefix>/
        <folder-hash>.json
  ranges/
    <workspace-folder-name>/
      <hash-prefix>/
        <file-hash>.json
```

In a single-folder workspace, PowerSearch creates `.powersearch` in that folder. In a multi-root workspace, PowerSearch prompts the user to choose which workspace folder owns `.powersearch`. If exactly one workspace folder already contains PowerSearch data, that folder is used automatically.

Workspace folder names must be unique. This keeps source references portable without storing absolute paths.

## `manifest.json`

Tracks schema version, storage ownership, and workspace-folder identities.

```json
{
  "schemaVersion": 2,
  "createdAt": "2026-04-24T15:00:00.000Z",
  "updatedAt": "2026-04-24T15:30:00.000Z",
  "storageWorkspace": "frontend",
  "workspaces": [
    { "id": "frontend", "name": "frontend" },
    { "id": "backend", "name": "backend" }
  ]
}
```

## `folders.json`

Stores only the UI folder tree. It does not contain ranges or Markdown note content.

```json
{
  "schemaVersion": 2,
  "folders": [
    {
      "id": "fld_2e3c...",
      "name": "Default",
      "color": "#ffff00",
      "inheritsColor": false,
      "isHidden": false,
      "expanded": true,
      "children": [
        {
          "id": "fld_9a10...",
          "name": "API",
          "color": "#0074D9",
          "isHidden": false,
          "expanded": false,
          "children": []
        }
      ]
    }
  ]
}
```

Folder IDs are stable identifiers. Ranges point to `folderId`, so folders can be renamed without rewriting all range shards.

`inheritsColor` is optional. When `true`, the folder resolves its decoration color from the nearest ancestor with an explicit color.

## `docs/root.md` and `docs/<folder-id>.md`

Stores optional Markdown notes for the synthetic root and for folders. These files are created on demand when the user opens notes.

Folder note paths are deterministic by `folderId`, so folder renames do not orphan notes. The synthetic root always uses `docs/root.md`.

## `indexes/folders/.../*.json`

Stores the ranges that should appear under each tree folder without duplicating the actual range payload.

```json
{
  "schemaVersion": 2,
  "folderId": "fld_2e3c...",
  "ranges": [
    {
      "id": "rng_f1a2...",
      "shard": "ranges/frontend/8f/8f21b2c9.json"
    }
  ]
}
```

Each entry is a reference to the real range record stored in a file shard. If a folder index points to a missing shard file, PowerSearch drops that dangling entry when loading the folder tree.

## `ui.json`

Stores persistent UI state, including the current target folder for new ranges and the synthetic root's shared color/visibility/expanded state.

```json
{
  "schemaVersion": 2,
  "selectedFolderId": "fld_2e3c...",
  "rootColor": "#ffff00",
  "rootIsHidden": false,
  "rootExpanded": true
}
```

`selectedFolderId` may be `null`.

## `indexes/files.json`

Indexes range shards without loading every shard at startup.

```json
{
  "schemaVersion": 2,
  "updatedAt": "2026-04-24T15:30:00.000Z",
  "workspaces": [
    {
      "workspaceFolder": "frontend",
      "files": [
        {
          "path": "src/components/Button.tsx",
          "shard": "ranges/frontend/8f/8f21b2c9.json",
          "rangeCount": 2,
          "folderCounts": {
            "fld_2e3c...": 1,
            "fld_9a10...": 1
          }
        }
      ]
    }
  ]
}
```

The index is an optimization and discovery aid. The source of truth for ranges remains the shard file listed by `shard`.

## Range Shards

Each source file has one range shard, and only the shard stores the actual range coordinates.

```json
{
  "schemaVersion": 2,
  "workspaceFolder": "frontend",
  "path": "src/components/Button.tsx",
  "ranges": [
    {
      "id": "rng_f1a2...",
      "folderId": "fld_2e3c...",
      "range": {
        "start": { "line": 12, "character": 4 },
        "end": { "line": 12, "character": 18 }
      }
    }
  ]
}
```

Runtime resolution is:

```text
workspace folder named <workspaceFolder> + relative <path>
```

Files outside the open workspace cannot be represented in the current format and are skipped with a warning.

## Performance Model

- Startup reads `manifest.json`, `folders.json`, `ui.json`, and `indexes/files.json`.
- Tree rendering reads the lightweight per-folder indexes to reconstruct reference rows without loading every file shard up front.
- Folder notes are lazy-loaded only when the user opens a folder's Markdown file.
- The synthetic root's UI state is read from `ui.json`; its color acts as the fallback parent color for inherited folders, and its hidden state suppresses all descendant decorations.
- Decorations for an editor read only that editor's range shard.
- Adding a range rewrites one file shard, one folder index, and the small file index.
- Renaming, recoloring, hiding, retargeting, or expanding folders rewrites only `folders.json` and `ui.json`.
- Deleting a folder removes its Markdown notes file, removes its folder-index file, removes ranges for that folder from affected shards, and updates the file index.

## Compatibility Rules

- Unsupported `schemaVersion` values should fail closed with a warning.
- Unknown optional fields should be preserved by migrations when practical.
- Folder indexes must not keep dangling references to missing shard files.
- Legacy absolute-URI state is migrated only when the referenced files are inside the open workspace. The migrated current-format files contain workspace-folder names and relative paths only.
