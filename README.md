# PowerSearch

PowerSearch is a VS Code extension for grouping and coloring source ranges. It stores workspace-visible state in `.powersearch` using a sharded format designed for large numbers of ranges, with lightweight per-folder range indexes for the tree and per-file shards for the actual range payload.

## Current UX

- Pick a **target folder** before coloring selections or lines. Right-click a folder to set it as the target, and right-click the current target to clear it.
- Left-click a folder to open its notes. The status bar plus tree badge show which folder is the current target.
- Folder colors can be explicit, cleared, or set to **Parent** so a folder inherits the nearest colored ancestor.
- Folder notes are Markdown files stored in `.powersearch/docs/` and opened by clicking the folder or from the folder context menu.

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
