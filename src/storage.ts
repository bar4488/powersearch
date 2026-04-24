import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { FolderData, FolderItem, StoredRange, createFolderItem, createId, rangeToData } from './tree/tree_item';

const STORAGE_DIRECTORY = '.powersearch';
const MANIFEST_FILE = 'manifest.json';
const FOLDERS_FILE = 'folders.json';
const UI_FILE = 'ui.json';
const FILES_INDEX = 'indexes/files.json';
const LEGACY_STATE_FILE = 'state.json';
const LEGACY_WORKSPACE_STATE_KEY = 'treeData';
const SCHEMA_VERSION = 2;

interface WorkspaceDescriptor {
	id: string;
	name: string;
}

interface ManifestFile {
	schemaVersion: typeof SCHEMA_VERSION;
	createdAt: string;
	updatedAt: string;
	storageWorkspace: string;
	workspaces: WorkspaceDescriptor[];
}

interface FoldersFile {
	schemaVersion: typeof SCHEMA_VERSION;
	folders: FolderData[];
}

interface UiFile {
	schemaVersion: typeof SCHEMA_VERSION;
	selectedFolderId: string | null;
}

interface FileIndex {
	schemaVersion: typeof SCHEMA_VERSION;
	updatedAt: string;
	workspaces: WorkspaceFileIndex[];
}

interface WorkspaceFileIndex {
	workspaceFolder: string;
	files: FileIndexEntry[];
}

interface FileIndexEntry {
	path: string;
	shard: string;
	rangeCount: number;
	folderCounts: Record<string, number>;
}

interface RangeShardFile {
	schemaVersion: typeof SCHEMA_VERSION;
	workspaceFolder: string;
	path: string;
	ranges: StoredRange[];
}

interface WorkspaceFileKey {
	workspaceFolder: string;
	path: string;
}

export interface LoadedPowerSearchState {
	folders: FolderItem[];
	selectedFolderId: string | null;
}

export interface AddRangesResult {
	added: number;
	skippedOutsideWorkspace: number;
}

export class PowerSearchStorage {
	private readonly rangeCache = new Map<string, RangeShardFile>();
	private index: FileIndex = emptyIndex();

	private constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly storageFolder: vscode.WorkspaceFolder,
		private readonly workspaces: WorkspaceDescriptor[],
	) { }

	static async open(context: vscode.ExtensionContext): Promise<PowerSearchStorage | undefined> {
		const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
		if (workspaceFolders.length === 0) {
			void vscode.window.showWarningMessage('PowerSearch requires an open workspace folder to persist data.');
			return undefined;
		}

		const duplicates = findDuplicateNames(workspaceFolders);
		if (duplicates.length > 0) {
			void vscode.window.showErrorMessage(`PowerSearch requires unique workspace folder names. Rename duplicates: ${duplicates.join(', ')}.`);
			return undefined;
		}

		const storageFolder = await chooseStorageFolder(workspaceFolders);
		if (!storageFolder) {
			void vscode.window.showWarningMessage('PowerSearch storage was not configured. Choose a workspace folder to enable persistence.');
			return undefined;
		}

		const storage = new PowerSearchStorage(context, storageFolder, workspaceFolders.map((folder) => ({
			id: folder.name,
			name: folder.name,
		})));
		await storage.initialize();
		return storage;
	}

	async loadState(): Promise<LoadedPowerSearchState> {
		try {
			await this.migrateLegacyStateIfNeeded();
			const folders = await this.readJson<FoldersFile>(this.foldersUri(), { schemaVersion: SCHEMA_VERSION, folders: [] });
			const ui = await this.readJson<UiFile>(this.uiUri(), { schemaVersion: SCHEMA_VERSION, selectedFolderId: null });
			if (folders.schemaVersion !== SCHEMA_VERSION || !Array.isArray(folders.folders)) {
				throw new Error('Unsupported folders.json schema.');
			}
			if (ui.schemaVersion !== SCHEMA_VERSION) {
				throw new Error('Unsupported ui.json schema.');
			}
			return {
				folders: folders.folders.map((folder) => deserializeFolder(folder)),
				selectedFolderId: ui.selectedFolderId,
			};
		}
		catch (error) {
			void vscode.window.showWarningMessage(`PowerSearch could not load .powersearch data: ${error instanceof Error ? error.message : String(error)}`);
			return { folders: [], selectedFolderId: null };
		}
	}

	async saveFolders(folders: FolderItem[]): Promise<void> {
		await this.writeJson(this.foldersUri(), {
			schemaVersion: SCHEMA_VERSION,
			folders: folders.map(serializeFolder),
		});
		await this.touchManifest();
	}

	async saveUi(selectedFolderId: string | null): Promise<void> {
		await this.writeJson(this.uiUri(), {
			schemaVersion: SCHEMA_VERSION,
			selectedFolderId,
		});
		await this.touchManifest();
	}

	async addRanges(locations: vscode.Location[], folderId: string): Promise<AddRangesResult> {
		const grouped = new Map<string, { key: WorkspaceFileKey; ranges: vscode.Range[] }>();
		let skippedOutsideWorkspace = 0;

		for (const location of locations) {
			const key = this.keyForUri(location.uri);
			if (!key) {
				skippedOutsideWorkspace += 1;
				continue;
			}
			const cacheKey = fileCacheKey(key);
			const entry = grouped.get(cacheKey) ?? { key, ranges: [] };
			entry.ranges.push(location.range);
			grouped.set(cacheKey, entry);
		}

		let added = 0;
		for (const entry of grouped.values()) {
			const shard = await this.loadRangeShard(entry.key);
			const existingRanges = new Set(shard.ranges.map(rangeIdentity));
			let shardChanged = false;
			for (const range of entry.ranges) {
				const storedRange = rangeToData(range);
				const identity = rangeIdentity({ folderId, range: storedRange });
				if (existingRanges.has(identity)) {
					continue;
				}
				shard.ranges.push({
					id: createId('rng'),
					folderId,
					range: storedRange,
				});
				existingRanges.add(identity);
				added += 1;
				shardChanged = true;
			}
			if (shardChanged) {
				await this.saveRangeShard(shard);
			}
		}

		if (added > 0) {
			await this.writeIndex();
			await this.touchManifest();
		}

		return { added, skippedOutsideWorkspace };
	}

	async getRangesForDocument(uri: vscode.Uri): Promise<StoredRange[]> {
		const key = this.keyForUri(uri);
		if (!key) {
			return [];
		}
		const shard = await this.loadRangeShard(key);
		return shard.ranges;
	}

	async removeRangesForFolders(folderIds: Set<string>): Promise<void> {
		if (folderIds.size === 0) {
			return;
		}

		let changed = false;
		for (const workspace of [...this.index.workspaces]) {
			for (const file of [...workspace.files]) {
				const shard = await this.loadRangeShard({ workspaceFolder: workspace.workspaceFolder, path: file.path });
				const nextRanges = shard.ranges.filter((range) => !folderIds.has(range.folderId));
				if (nextRanges.length === shard.ranges.length) {
					continue;
				}
				changed = true;
				shard.ranges = nextRanges;
				if (shard.ranges.length === 0) {
					await this.deleteRangeShard(shard);
				}
				else {
					await this.saveRangeShard(shard);
				}
			}
		}

		if (changed) {
			await this.writeIndex();
			await this.touchManifest();
		}
	}

	async clearAll(): Promise<void> {
		try {
			await vscode.workspace.fs.delete(this.storageRootUri(), { recursive: true });
		}
		catch (error) {
			if (!isFileNotFoundError(error)) {
				throw error;
			}
		}
		this.index = emptyIndex();
		this.rangeCache.clear();
		await this.context.workspaceState.update(LEGACY_WORKSPACE_STATE_KEY, undefined);
		await this.initialize();
	}

	getWorkspaceRelativePath(uri: vscode.Uri): WorkspaceFileKey | undefined {
		return this.keyForUri(uri);
	}

	private async initialize(): Promise<void> {
		await vscode.workspace.fs.createDirectory(this.storageRootUri());
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.storageRootUri(), 'ranges'));
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.storageRootUri(), 'indexes'));
		const manifest = await this.readJson<ManifestFile | undefined>(this.manifestUri(), undefined);
		if (!manifest) {
			await this.writeManifest(new Date().toISOString());
		}
		this.index = await this.readJson<FileIndex>(this.indexUri(), emptyIndex());
		if (this.index.schemaVersion !== SCHEMA_VERSION || !Array.isArray(this.index.workspaces)) {
			this.index = emptyIndex();
			await this.writeIndex();
		}
	}

	private async migrateLegacyStateIfNeeded(): Promise<void> {
		const foldersExist = await exists(this.foldersUri());
		if (foldersExist) {
			return;
		}

		const migratedFolders: FolderItem[] = [];
		let migratedRanges = 0;

		const legacyFile = await this.readJson<any | undefined>(vscode.Uri.joinPath(this.storageRootUri(), LEGACY_STATE_FILE), undefined);
		if (legacyFile?.schemaVersion === 1 && legacyFile.tree?.type === 'root') {
			migratedRanges += await this.migrateLegacyNodes(legacyFile.tree.children ?? [], migratedFolders, undefined);
			await this.deleteIfExists(vscode.Uri.joinPath(this.storageRootUri(), LEGACY_STATE_FILE));
		}

		const legacyWorkspaceTree = this.context.workspaceState.get<any[]>(LEGACY_WORKSPACE_STATE_KEY, []);
		if (legacyWorkspaceTree.length > 0) {
			migratedRanges += await this.migrateLegacyNodes(legacyWorkspaceTree, migratedFolders, undefined);
			await this.context.workspaceState.update(LEGACY_WORKSPACE_STATE_KEY, undefined);
		}

		if (migratedFolders.length > 0) {
			await this.saveFolders(migratedFolders);
			if (migratedRanges > 0) {
				await this.writeIndex();
			}
			void vscode.window.showInformationMessage(`Migrated PowerSearch data to ${STORAGE_DIRECTORY}.`);
		}
	}

	private async migrateLegacyNodes(nodes: any[], target: FolderItem[], parent: FolderItem | undefined): Promise<number> {
		let migratedRanges = 0;
		for (const node of nodes) {
			if (node?.type === 'folder') {
				const folder = createFolderItem({
					name: node.name ?? 'Folder',
					color: node.color,
					children: [],
					isHidden: node.isHidden ?? false,
					expanded: node.expanded,
					parent,
				});
				target.push(folder);
				migratedRanges += await this.migrateLegacyNodes(node.children ?? node.references ?? [], folder.children, folder);
			}
			else if (node?.type === 'ref' && parent) {
				const location = legacyLocationToVscode(node.location);
				if (location) {
					const result = await this.addRanges([location], parent.id);
					migratedRanges += result.added;
				}
			}
		}
		return migratedRanges;
	}

	private keyForUri(uri: vscode.Uri): WorkspaceFileKey | undefined {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		if (!workspaceFolder) {
			return undefined;
		}
		const path = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
		return {
			workspaceFolder: workspaceFolder.name,
			path,
		};
	}

	private async loadRangeShard(key: WorkspaceFileKey): Promise<RangeShardFile> {
		const cacheKey = fileCacheKey(key);
		const cached = this.rangeCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		const indexEntry = this.findIndexEntry(key);
		const emptyShard: RangeShardFile = {
			schemaVersion: SCHEMA_VERSION,
			workspaceFolder: key.workspaceFolder,
			path: key.path,
			ranges: [],
		};
		const shard = indexEntry ? await this.readJson<RangeShardFile>(this.relativeUri(indexEntry.shard), emptyShard) : emptyShard;
		if (shard.schemaVersion !== SCHEMA_VERSION || !Array.isArray(shard.ranges)) {
			throw new Error(`Unsupported range shard schema for ${key.workspaceFolder}/${key.path}.`);
		}
		this.rangeCache.set(cacheKey, shard);
		return shard;
	}

	private async saveRangeShard(shard: RangeShardFile): Promise<void> {
		const shardPath = shardRelativePath({ workspaceFolder: shard.workspaceFolder, path: shard.path });
		await this.writeJson(this.relativeUri(shardPath), shard);
		this.rangeCache.set(fileCacheKey(shard), shard);
		this.upsertIndexEntry(shard, shardPath);
	}

	private async deleteRangeShard(shard: RangeShardFile): Promise<void> {
		const entry = this.findIndexEntry(shard);
		if (entry) {
			await this.deleteIfExists(this.relativeUri(entry.shard));
		}
		this.rangeCache.delete(fileCacheKey(shard));
		this.removeIndexEntry(shard);
	}

	private upsertIndexEntry(shard: RangeShardFile, shardPath: string): void {
		let workspace = this.index.workspaces.find((item) => item.workspaceFolder === shard.workspaceFolder);
		if (!workspace) {
			workspace = { workspaceFolder: shard.workspaceFolder, files: [] };
			this.index.workspaces.push(workspace);
		}
		let file = workspace.files.find((item) => item.path === shard.path);
		if (!file) {
			file = { path: shard.path, shard: shardPath, rangeCount: 0, folderCounts: {} };
			workspace.files.push(file);
		}
		file.shard = shardPath;
		file.rangeCount = shard.ranges.length;
		file.folderCounts = countByFolder(shard.ranges);
		workspace.files.sort((a, b) => a.path.localeCompare(b.path));
	}

	private removeIndexEntry(key: WorkspaceFileKey): void {
		const workspace = this.index.workspaces.find((item) => item.workspaceFolder === key.workspaceFolder);
		if (!workspace) {
			return;
		}
		workspace.files = workspace.files.filter((item) => item.path !== key.path);
		if (workspace.files.length === 0) {
			this.index.workspaces = this.index.workspaces.filter((item) => item !== workspace);
		}
	}

	private findIndexEntry(key: WorkspaceFileKey): FileIndexEntry | undefined {
		return this.index.workspaces
			.find((workspace) => workspace.workspaceFolder === key.workspaceFolder)
			?.files.find((file) => file.path === key.path);
	}

	private async writeIndex(): Promise<void> {
		this.index.updatedAt = new Date().toISOString();
		this.index.workspaces.sort((a, b) => a.workspaceFolder.localeCompare(b.workspaceFolder));
		await this.writeJson(this.indexUri(), this.index);
	}

	private async touchManifest(): Promise<void> {
		const manifest = await this.readJson<ManifestFile | undefined>(this.manifestUri(), undefined);
		await this.writeManifest(manifest?.createdAt ?? new Date().toISOString());
	}

	private async writeManifest(createdAt: string): Promise<void> {
		await this.writeJson(this.manifestUri(), {
			schemaVersion: SCHEMA_VERSION,
			createdAt,
			updatedAt: new Date().toISOString(),
			storageWorkspace: this.storageFolder.name,
			workspaces: this.workspaces,
		});
	}

	private async readJson<T>(uri: vscode.Uri, fallback: T): Promise<T> {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			return JSON.parse(new TextDecoder().decode(bytes)) as T;
		}
		catch (error) {
			if (isFileNotFoundError(error)) {
				return fallback;
			}
			throw error;
		}
	}

	private async writeJson(uri: vscode.Uri, data: unknown): Promise<void> {
		await vscode.workspace.fs.createDirectory(parentUri(uri));
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(data, null, 2) + '\n'));
	}

	private async deleteIfExists(uri: vscode.Uri): Promise<void> {
		try {
			await vscode.workspace.fs.delete(uri);
		}
		catch (error) {
			if (!isFileNotFoundError(error)) {
				throw error;
			}
		}
	}

	private storageRootUri(): vscode.Uri {
		return vscode.Uri.joinPath(this.storageFolder.uri, STORAGE_DIRECTORY);
	}

	private manifestUri(): vscode.Uri {
		return vscode.Uri.joinPath(this.storageRootUri(), MANIFEST_FILE);
	}

	private foldersUri(): vscode.Uri {
		return vscode.Uri.joinPath(this.storageRootUri(), FOLDERS_FILE);
	}

	private uiUri(): vscode.Uri {
		return vscode.Uri.joinPath(this.storageRootUri(), UI_FILE);
	}

	private indexUri(): vscode.Uri {
		return vscode.Uri.joinPath(this.storageRootUri(), FILES_INDEX);
	}

	private relativeUri(relativePath: string): vscode.Uri {
		return vscode.Uri.joinPath(this.storageRootUri(), ...relativePath.split('/'));
	}
}

function serializeFolder(folder: FolderItem): FolderData {
	const data: FolderData = {
		id: folder.id,
		name: folder.name,
		children: folder.children.map(serializeFolder),
		isHidden: folder.isHidden,
	};
	if (folder.color) {
		data.color = folder.color;
	}
	if (folder.expanded !== undefined) {
		data.expanded = folder.expanded;
	}
	return data;
}

function deserializeFolder(data: FolderData, parent?: FolderItem): FolderItem {
	const folder = createFolderItem({
		id: data.id,
		name: data.name,
		color: data.color,
		children: [],
		isHidden: data.isHidden ?? false,
		expanded: data.expanded,
		parent,
	});
	folder.children = data.children.map((child) => deserializeFolder(child, folder));
	return folder;
}

async function chooseStorageFolder(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<vscode.WorkspaceFolder | undefined> {
	const existing: vscode.WorkspaceFolder[] = [];
	for (const folder of workspaceFolders) {
		if (await exists(vscode.Uri.joinPath(folder.uri, STORAGE_DIRECTORY, MANIFEST_FILE)) || await exists(vscode.Uri.joinPath(folder.uri, STORAGE_DIRECTORY, FOLDERS_FILE))) {
			existing.push(folder);
		}
	}
	if (existing.length === 1) {
		return existing[0];
	}

	if (workspaceFolders.length === 1 && existing.length === 0) {
		return workspaceFolders[0];
	}

	const candidates = existing.length > 0 ? existing : [...workspaceFolders];
	const picked = await vscode.window.showQuickPick(candidates.map((folder) => ({
		label: folder.name,
		description: existing.length > 0 ? 'Existing PowerSearch data' : 'Create .powersearch here',
		folder,
	})), {
		placeHolder: existing.length > 0
			? 'Multiple PowerSearch folders were found. Choose which one to use.'
			: 'Choose where PowerSearch should create .powersearch for this multi-root workspace.',
	});
	return picked?.folder;
}

function findDuplicateNames(workspaceFolders: readonly vscode.WorkspaceFolder[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const folder of workspaceFolders) {
		if (seen.has(folder.name)) {
			duplicates.add(folder.name);
		}
		seen.add(folder.name);
	}
	return [...duplicates];
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	}
	catch {
		return false;
	}
}

function emptyIndex(): FileIndex {
	return {
		schemaVersion: SCHEMA_VERSION,
		updatedAt: new Date().toISOString(),
		workspaces: [],
	};
}

function fileCacheKey(key: WorkspaceFileKey): string {
	return `${key.workspaceFolder}\0${key.path}`;
}

function shardRelativePath(key: WorkspaceFileKey): string {
	const digest = crypto.createHash('sha1').update(fileCacheKey(key)).digest('hex');
	return `ranges/${encodeURIComponent(key.workspaceFolder)}/${digest.slice(0, 2)}/${digest}.json`;
}

function countByFolder(ranges: StoredRange[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const range of ranges) {
		counts[range.folderId] = (counts[range.folderId] ?? 0) + 1;
	}
	return counts;
}

function rangeIdentity(range: Pick<StoredRange, 'folderId' | 'range'>): string {
	return [
		range.folderId,
		range.range.start.line,
		range.range.start.character,
		range.range.end.line,
		range.range.end.character,
	].join(':');
}

function parentUri(uri: vscode.Uri): vscode.Uri {
	const parentPath = uri.path.replace(/\/[^/]*$/, '') || '/';
	return uri.with({ path: parentPath });
}

function legacyLocationToVscode(location: any): vscode.Location | undefined {
	if (!location?.uriString || !location?.range) {
		return undefined;
	}
	const range = new vscode.Range(
		new vscode.Position(location.range.start.line, location.range.start.character),
		new vscode.Position(location.range.end.line, location.range.end.character),
	);
	return new vscode.Location(vscode.Uri.parse(location.uriString), range);
}

function isFileNotFoundError(error: unknown): boolean {
	return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}
