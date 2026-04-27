# PowerSearch

PowerSearch is a VS Code extension for grouping and coloring source ranges. It stores workspace-visible state in `.powersearch` using a sharded format designed for large numbers of ranges, with lightweight per-folder range indexes for the tree and per-file shards for the actual range payload.

## Current UX

- The PowerSearch side bar has two stacked views: **Folders** and **Search**.
- **Folders** stays focused on the folder tree and acts as the root action surface for folder-wide actions such as creating folders, setting the shared default color, toggling shared visibility, opening root notes, or clearing the current target.
- Pick a **target folder** before coloring selections or lines. Right-click a folder to set it as the target, and right-click the current target to clear it.
- Left-click a folder to open its notes. The status bar plus tree badge show which folder is the current target.
- Drag one or many stored ranges onto another folder to move them. Each range row also has an inline delete button, and both actions keep the tree index and file shard storage in sync.
- Folder colors can be explicit, cleared, or set to **Parent** so a folder inherits the nearest colored ancestor, including the synthetic root's default color.
- Hiding the synthetic root suppresses all descendant decorations until it is shown again.
- Folder notes are Markdown files stored in `.powersearch/docs/` and opened by clicking the folder or from the folder context menu. The synthetic root uses `.powersearch/docs/root.md`.
- **Search** is a dedicated search view with inline inputs instead of step-by-step dialogs: search text, in-field match toggles, button-based scope selection, workspace selection, include/exclude globs, and results all live in one surface.
- After a search runs, you can open matches directly or save the results into any existing folder as normal ranges.

## Development

Install dependencies:

```sh
npm ci
```

Run checks:

```sh
npm run compile
npm run lint
npm test
```

## Run The Extension From The CLI

Compile the extension and open VS Code with this checkout loaded as the development extension:

```sh
npm run compile
code --new-window --extensionDevelopmentPath="$PWD" "$PWD"
```

From outside the repo, use absolute paths:

```sh
npm run compile
code --new-window --extensionDevelopmentPath=/path/to/powersearch /path/to/workspace
```
