# PowerSearch Service Architecture

## Goal

PowerSearch should have one local authority for reading and mutating `.powersearch` state.
Both the VS Code extension and the global MCP server should delegate to that authority instead of writing storage files directly.

This document proposes a per-project local service, similar in role to an LSP server:

- the extension is a UI client
- the MCP server is an agent client
- the service owns storage access, validation, and write ordering

## Why A Service

The current extension implementation mixes storage logic and VS Code-facing orchestration. That is fine while the extension is the only client, but it becomes fragile once an MCP server is added.

Without a service, there are two bad options:

1. Duplicate PowerSearch logic in the extension and the MCP server.
2. Let two independent processes write `.powersearch` concurrently.

The service avoids both problems.

Benefits:

- one implementation of folder, range, search, and storage behavior
- one write queue for all mutations
- one place for schema validation and migration
- one place for cache invalidation and indexing
- one concurrency model instead of best-effort file coordination across clients

## Non-Goals

- No network-facing daemon.
- No shared machine-wide service for all projects.
- No direct client writes to `.powersearch` in normal operation.
- No runtime state outside `.powersearch` for lock files, socket metadata, or service pid metadata.

## Service Scope

The service is scoped to a single PowerSearch storage root.

Example:

```text
/repo/.powersearch
```

There is at most one live service instance per storage root.

This is intentionally not a single daemon for all projects. A per-project service keeps:

- failure domains small
- locking simple
- cache ownership obvious
- endpoint discovery deterministic

## Storage Model

The existing `.powersearch` directory remains the durable source of truth.

Portable files continue to describe project state:

- `manifest.json`
- `folders.json`
- `searches.json`
- `ui.json`
- `settings.json`
- `indexes/...`
- `ranges/...`
- `docs/...`

Machine-local configuration is added as a separate file:

- `local.json`

Runtime service state is stored under a dedicated directory:

- `runtime/`

Proposed layout:

```text
.powersearch/
  manifest.json
  folders.json
  searches.json
  ui.json
  settings.json
  local.json
  runtime/
    service.lock
    service.json
    service.sock        # unix
  docs/
  indexes/
  ranges/
```

On Windows, `runtime/service.sock` is replaced by a named-pipe name recorded in `runtime/service.json`.

## `local.json`

`local.json` is machine-local metadata. It is not portable and should not be treated as part of the cross-machine project format.

Its purpose is to let the service resolve workspace-folder names from the manifest and range shards into real local paths, including cases where `.powersearch` is stored outside the project root.

Proposed shape:

```json
{
  "version": 1,
  "workspaceRoots": [
    {
      "name": "powersearch",
      "path": "/home/bar/dev/projects/powersearch"
    }
  ]
}
```

Rules:

- `name` must match the workspace folder names referenced by the portable storage format.
- `path` is an absolute local path.
- the service owns validation of duplicate names and missing paths.
- clients may request initialization or repair if `local.json` is missing or stale.

## No Direct Fallback

There is no direct in-process fallback path for normal extension or MCP operations.

Reasoning:

- a fallback duplicates behavior across service-backed and direct modes
- duplicated mutation paths are likely to drift over time
- concurrency guarantees become weaker the moment a bypass exists
- debugging gets harder because behavior depends on which path was taken

The clients should have only two modes:

1. connect to a compatible service
2. start the service and then connect

If both fail, the client reports a bootstrap error instead of silently switching to a different implementation.

The only exception is minimal diagnostics that read a small amount of metadata such as `manifest.json`, `local.json`, or `runtime/service.json` to explain why startup failed.

## Bootstrapping

### Extension bootstrap

The extension identifies the target `.powersearch` root the same way it already does today.

Then it:

1. checks `.powersearch/runtime/service.json`
2. attempts to connect to the declared endpoint
3. if connect succeeds, performs protocol handshake
4. if no service is reachable, attempts to acquire the start lock
5. if lock acquisition succeeds, spawns the service
6. waits for the service to publish readiness
7. connects and performs protocol handshake

### MCP bootstrap

The global MCP server is configured with an environment variable that points to the PowerSearch home for the current target project.

Recommended environment variable:

```text
POWERSEARCH_PATH=/absolute/path/to/project/.powersearch
```

The MCP server then follows the same sequence as the extension:

1. validate `POWERSEARCH_PATH`
2. inspect `.powersearch/runtime/service.json`
3. connect if possible
4. otherwise attempt startup with the same lock protocol

This keeps the extension and MCP aligned. The MCP does not need a separate project registry in the first service-backed version if it is launched for one project at a time.

## Locking And Startup Ownership

All startup coordination lives inside `.powersearch/runtime/`.

This is preferable to hashing the storage root into an external temp path because:

- runtime artifacts remain colocated with the project state they protect
- the system never needs to write outside `.powersearch`
- inspection and cleanup are simpler
- behavior is deterministic even if temp directories are cleaned or remapped

### Files

`runtime/service.lock`

- indicates that a process is currently trying to start or currently owns startup
- created with exclusive semantics
- contains pid, created timestamp, and intended endpoint information

`runtime/service.json`

- published by the running service after successful bind
- contains endpoint information, pid, protocol version, service version, and last-start timestamp

### Startup algorithm

1. client reads `runtime/service.json` if present
2. client attempts to connect
3. if the endpoint responds and handshake succeeds, use it
4. otherwise client attempts to create `runtime/service.lock` exclusively
5. if lock creation succeeds, client spawns the service
6. service binds endpoint, writes `runtime/service.json`, and releases or converts the lock into ownership metadata
7. if lock creation fails, client waits briefly for `runtime/service.json` to become healthy, then retries connect
8. if the lock is stale and no endpoint is live, a client may remove the stale lock and retry startup

### Stale lock detection

A lock is stale if:

- its pid is no longer alive, or
- it exceeds a startup timeout and no endpoint can be contacted

Stale-lock cleanup must be conservative. Clients should always probe for a live endpoint before removing lock state.

## Endpoint Transport

Use local IPC only.

Platform transport:

- Linux and macOS: Unix domain socket at `.powersearch/runtime/service.sock`
- Windows: named pipe, with the pipe name stored in `.powersearch/runtime/service.json`

The service should not listen on TCP.

## Protocol

Use JSON-RPC style request/response messaging over the local stream.

Reasons:

- easy to inspect and debug
- maps well to command-style PowerSearch operations
- supports future notifications without redesign
- familiar operational model

Each session starts with a handshake that validates compatibility.

Handshake fields:

- protocol version
- service version
- PowerSearch schema version
- client kind: `extension` or `mcp`
- client version
- capability flags

If the versions are incompatible, the service rejects the session with a structured error.

## Responsibilities

### Core library

The core library owns:

- storage schema types
- file read and write logic
- folder and range mutation rules
- validation and migration logic
- file index maintenance
- local path resolution through `local.json`

The core library must not depend on VS Code APIs.

### Service

The service owns:

- process lifecycle
- endpoint bind and handshake
- in-memory caches
- serialization of writes
- watch and invalidation policy
- translation between RPC methods and core operations
- runtime metadata in `.powersearch/runtime/`

### Extension client

The extension owns:

- tree view and webview UI
- editor decoration application
- converting user gestures into service requests
- reacting to service notifications or polling-based refresh if notifications are deferred

### MCP client

The MCP server owns:

- exposing PowerSearch operations as tools
- translating tool inputs into service requests
- formatting service results for agents

## Concurrency Model

The service is the only writer.

Implications:

- all mutations are serialized through one queue
- compound operations remain internally consistent
- index files and range shards are updated together
- extension and MCP cannot race each other by writing files directly

The service may allow concurrent reads, but writes must be ordered.

Future enhancement:

- add revisions or transactions to allow stronger client-side optimistic concurrency checks

## Failure Model

Expected failures:

- missing `.powersearch`
- missing or invalid `local.json`
- service binary or entrypoint unavailable
- stale lock file
- incompatible protocol version
- incompatible schema version
- broken endpoint after crash

Client behavior should be explicit:

- report bootstrap failures clearly
- never silently switch to direct file mutation
- surface repair actions when the service can describe them

## Initial RPC Surface

V1 should start with the smallest useful API.

Bootstrap and health:

- `handshake`
- `ping`
- `getStatus`

Project metadata:

- `getManifest`
- `getLocalConfig`
- `updateLocalConfig`

Read operations:

- `getFolderTree`
- `getFolderDoc`
- `listSavedSearches`
- `getRangesForFile`
- `resolveReference`

Mutation operations:

- `saveFolders`
- `saveUi`
- `saveSearches`
- `addRanges`
- `moveRange`
- `deleteRange`
- `updateRangeComment`
- `removeFolder`
- `duplicateFolder`

This should mirror current behavior, not redesign it yet.

## Service Notifications

Notifications are optional for the first implementation, but the protocol should reserve space for them.

Likely notifications:

- `foldersChanged`
- `uiChanged`
- `searchesChanged`
- `rangesChanged`
- `serviceStopping`

If notifications are deferred, the extension can request refresh after each successful mutation.

## Execution Phases

### Phase 1: Extract core

Goal: separate storage logic from VS Code-specific code.

Deliverables:

- create a `powersearch-core` module with no VS Code dependency in its domain logic
- move schema, validation, and mutation behavior into the core
- keep the extension in-process for now, but only through the core interface
- define `local.json` schema and validation

Exit criteria:

- current extension behavior still works
- core logic can be exercised without tree view or webview code

### Phase 2: Introduce service runtime

Goal: make the extension service-backed.

Deliverables:

- create `powersearch-service`
- add `.powersearch/runtime/` lifecycle management
- implement startup lock and stale-lock recovery
- implement local IPC transport
- implement protocol handshake and the minimal RPC surface
- switch the extension to use the service for reads and writes

Exit criteria:

- extension startup can connect or spawn deterministically
- no normal extension mutation path writes storage directly
- crashes leave recoverable runtime state

### Phase 3: Add MCP integration

Goal: expose PowerSearch to agents without duplicating logic.

Deliverables:

- create a global MCP server that uses `POWERSEARCH_PATH`
- implement read-oriented tools first
- add mutation tools after service-backed writes are stable
- map service errors into agent-usable MCP errors

Exit criteria:

- agents can inspect folder trees, docs, searches, and ranges through MCP
- agents can perform supported mutations through the same service API as the extension

### Phase 4: Improve synchronization and observability

Goal: harden the system for daily use.

Deliverables:

- add notifications or subscriptions
- add richer diagnostics and logs
- add revision-based mutation guards if needed
- add repair commands for stale runtime metadata and invalid `local.json`

Exit criteria:

- clients recover cleanly from common failure modes
- diagnostic data is sufficient to explain bootstrap failures

## Open Decisions

These items still need implementation decisions:

- whether the service is packaged inside the extension repo or as a separately launched artifact
- whether the extension talks to the service through a Node child process wrapper or a standalone executable
- whether notifications are included in v1 or deferred until phase 4
- whether schema migration stays in the service only or is also available as an offline command

## Recommended Direction

Adopt the service architecture.

Specific choices for the first implementation:

- no direct fallback mutation path
- per-project service scoped to one `.powersearch` root
- `POWERSEARCH_PATH` as the MCP bootstrap input
- `local.json` for machine-local workspace root resolution
- `runtime/` inside `.powersearch` for lock and endpoint metadata
- local IPC with Unix socket on Unix-like systems and named pipe on Windows
- JSON-RPC style protocol with explicit handshake and version checks