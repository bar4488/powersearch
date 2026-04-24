# PowerSearch State Format

PowerSearch stores workspace data in `.powersearch/state.json` at the root of the first VS Code workspace folder. The file is intentionally plain JSON so it can be inspected, backed up, committed, reviewed, or shared with the workspace.

## File Location

```text
<workspace-root>/.powersearch/state.json
```

For multi-root VS Code workspaces, the current implementation uses the first workspace folder returned by VS Code.

## Versioning

Every state file includes a `schemaVersion`. Readers must reject unsupported versions instead of silently guessing.

Current version:

```json
{
  "schemaVersion": 1
}
```

## Top-Level Shape

```json
{
  "schemaVersion": 1,
  "savedAt": "2026-04-24T15:30:00.000Z",
  "tree": {
    "type": "root",
    "children": []
  },
  "ui": {
    "selectedFolderPath": null
  }
}
```

Fields:

- `schemaVersion`: numeric schema version. Currently `1`.
- `savedAt`: ISO-8601 UTC timestamp of the last save.
- `tree`: root tree node. The root itself is not shown as a folder in the UI.
- `ui`: persistent UI state that should follow the workspace.

## Tree Nodes

`tree.children` contains folder and reference nodes.

### Folder Node

```json
{
  "type": "folder",
  "name": "Default",
  "children": [],
  "location": {
    "uriString": "file:///workspace/src/example.ts",
    "range": {
      "start": { "line": 10, "character": 4 },
      "end": { "line": 10, "character": 11 }
    }
  },
  "color": "#ffff00",
  "isHidden": false,
  "expanded": true
}
```

Fields:

- `type`: always `"folder"`.
- `name`: display name.
- `children`: nested folder/reference nodes.
- `location`: optional source location for folders created from a symbol.
- `color`: optional decoration color in hex format.
- `isHidden`: optional visibility flag. Missing means visible.
- `expanded`: optional tree expansion flag. Missing means collapsed.

### Reference Node

```json
{
  "type": "ref",
  "location": {
    "uriString": "file:///workspace/src/example.ts",
    "range": {
      "start": { "line": 10, "character": 4 },
      "end": { "line": 10, "character": 11 }
    }
  }
}
```

Fields:

- `type`: always `"ref"`.
- `location`: target document URI and text range.

## Location Format

Locations use VS Code URI strings and zero-based line/character ranges:

```json
{
  "uriString": "file:///workspace/src/example.ts",
  "range": {
    "start": { "line": 10, "character": 4 },
    "end": { "line": 10, "character": 11 }
  }
}
```

## UI State

```json
{
  "selectedFolderPath": [0, 2]
}
```

`selectedFolderPath` identifies the selected folder by child indexes from the root. `null` means no selected folder. This is intentionally a UI hint, not a permanent node ID; if the tree is manually edited and the path no longer points to a folder, PowerSearch ignores it.

## Compatibility Rules

- Unknown fields should be preserved by future migrations when practical.
- Missing optional fields should use conservative defaults.
- Unsupported `schemaVersion` values should fail closed with a warning.
- Broken references should stay in the file. The UI may mark them as broken, but should not remove them without an explicit user action.

## Legacy Migration

Earlier versions stored tree data in VS Code `workspaceState`, which is hidden local storage. On first load, if `.powersearch/state.json` does not exist and legacy `workspaceState` data is present, PowerSearch migrates that data into `.powersearch/state.json` and clears the legacy key.
