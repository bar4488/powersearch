# PowerSearch

PowerSearch is a VS Code extension for grouping and coloring source ranges. It stores workspace-visible state in `.powersearch` using a sharded format designed for large numbers of ranges, with lightweight per-folder range indexes for the tree and per-file shards for the actual range payload.

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
