# PowerSearch

PowerSearch is a VS Code extension for collecting, coloring, and organizing code ranges into folders. It keeps the UI lightweight and stores its state in a workspace-visible `.powersearch` directory built for large sets of saved ranges.

## What It Does

- Save a line, selection, symbol, or search result into a folder.
- Color ranges in the editor and inherit colors through the folder tree.
- Keep notes per folder without touching source files.
- Move, duplicate, reveal, comment, or clean up saved ranges from the side bar.

## UX At A Glance

PowerSearch lives in two side-bar views: **Folders** and **Search**.

- **Folders** is where you organize ranges, set the current target folder, manage visibility, and open folder notes.
- **Search** is where you run scoped searches and save matches straight into a folder.
- Saved ranges track normal text edits. If the underlying text disappears, the range is removed instead of going stale.

## Development

Install dependencies and run the standard checks:

```sh
npm ci
npm run compile
npm run lint
npm test
```

## Run Locally

Compile the extension and launch a new VS Code window with this repo loaded as the development extension:

```sh
npm run compile
code --new-window --extensionDevelopmentPath="$PWD" "$PWD"
```

From outside the repo, use absolute paths for both the extension and the workspace:

```sh
code --new-window --extensionDevelopmentPath=/path/to/powersearch /path/to/workspace
```

## Build A VSIX

Create a distributable `.vsix` package with `vsce`:

```sh
npm ci
npm exec --package @vscode/vsce -- vsce package
```

That writes a file like `powersearch-0.0.3.vsix` in the project root. Install it in VS Code with:

```sh
code --install-extension powersearch-0.0.3.vsix
```
