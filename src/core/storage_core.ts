import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
	FolderData,
	FolderItem,
	LocalConfig,
	PositionData,
	RangeData,
	SavedSearchData,
	StoredRange,
	StoredRangeReference,
	WorkspaceDescriptor,
	WorkspaceRoot,
	createFolderItem,
	createId,
	createReferenceItem,
	referenceKey,
	sameStoredRangeReference,
} from './types';

export const STORAGE_DIRECTORY = '.powersearch';
export const SCHEMA_VERSION = 2;
export const LOCAL_CONFIG_VERSION = 1;

const MANIFEST_FILE = 'manifest.json';
const FOLDERS_FILE = 'folders.json';
const SEARCHES_FILE = 'searches.json';
const UI_FILE = 'ui.json';
const SETTINGS_FILE = 'settings.json';
const LOCAL_FILE = 'local.json';
const FILES_INDEX = 'indexes/files.json';
const FOLDER_RANGES_DIRECTORY = 'indexes/folders';
const DOCS_DIRECTORY = 'docs';
const DEFAULT_FOLDER_COLOR = '#0074D9';

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
	rootColor?: string;
	rootIsHidden?: boolean;
	rootExpanded?: boolean;
}

interface SearchesFile {
	schemaVersion: typeof SCHEMA_VERSION;
	searches: SavedSearchData[];
}

interface SettingsFile {
	schemaVersion: typeof SCHEMA_VERSION;
	defaultFolderColor: string;
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

interface FolderRangesFile {
	schemaVersion: typeof SCHEMA_VERSION;
	folderId: string;
	ranges: StoredRangeReference[];
}

interface RangeShardFile {
	schemaVersion: typeof SCHEMA_VERSION;
	workspaceFolder: string;
	path: string;
	ranges: StoredRange[];
}

export interface WorkspaceFileKey {
	workspaceFolder: string;
	path: string;
}

export interface PowerSearchCoreOptions {
	storageRoot: string;
	storageLocationLabel: string;
	workspaces: WorkspaceDescriptor[];
	workspaceRoots: WorkspaceRoot[];
}

export interface LoadedPowerSearchState {
	folders: FolderItem[];
	selectedFolderId: string | null;
	rootColor?: string;
	rootIsHidden: boolean;
	rootExpanded: boolean;
	searches: SavedSearchData[];
}

export interface PowerSearchSettings {
	defaultFolderColor: string;
}

export interface CoreLocation {
	key: WorkspaceFileKey;
	range: RangeData;
}

export interface AddRangesResult {
	added: number;
	addedReferences: StoredRangeReference[];
	skippedOutsideWorkspace: number;
}

export interface DeleteRangeResult {
	removed: boolean;
	prunedDangling: boolean;
}

export interface MoveRangeResult {
	outcome: 'moved' | 'deduplicated' | 'missing' | 'unchanged';
	reference?: StoredRangeReference;
}

export interface MoveRangeRequest {
	sourceFolderId: string;
	reference: StoredRangeReference;
}

export interface StoredDocumentRange {
	reference: StoredRangeReference;
	storedRange: StoredRange;
}

export interface ResolvedReference {
	file: WorkspaceFileKey;
	absolutePath: string;
	storedRange: StoredRange;
}

export interface TextContentChange {
	rangeOffset: number;
	rangeLength: number;
	text: string;
}

export interface UpdateRangesForDocumentResult {
	changed: boolean;
	removedReferences: StoredRangeReference[];
}

export interface DuplicateFolderRangesResult {
	addedReferencesByFolderId: Map<string, StoredRangeReference[]>;
}

export class PowerSearchCore {
	private readonly rangeCache = new Map<string, RangeShardFile>();
	private readonly rangeShardPathCache = new Map<string, RangeShardFile>();
	private readonly folderRangesCache = new Map<string, FolderRangesFile>();
	private index: FileIndex = emptyIndex();
	private rangeMutationQueue: Promise<void> = Promise.resolve();
	private workspaceRoots: WorkspaceRoot[];

	constructor(private readonly options: PowerSearchCoreOptions) {
		this.workspaceRoots = validateLocalConfig({
			version: LOCAL_CONFIG_VERSION,
			workspaceRoots: options.workspaceRoots,
		}).workspaceRoots;
	}

	async initialize(): Promise<void> {
		await assertWorkspaceRootsExist(this.workspaceRoots);
		await fs.mkdir(this.storageRootPath(), { recursive: true });
		await fs.mkdir(this.relativePath('ranges'), { recursive: true });
		await fs.mkdir(this.relativePath('indexes'), { recursive: true });
		await fs.mkdir(this.folderRangesDirectoryPath(), { recursive: true });
		await fs.mkdir(this.folderDocsDirectoryPath(), { recursive: true });
		await this.ensureSettings();
		await this.writeLocalConfig({
			version: LOCAL_CONFIG_VERSION,
			workspaceRoots: this.workspaceRoots,
		});
		const manifest = await this.readJson<ManifestFile | undefined>(this.manifestPath(), undefined);
		if (!manifest) {
			await this.writeManifest(new Date().toISOString());
		}
		this.index = await this.readJson<FileIndex>(this.indexPath(), emptyIndex());
		if (this.index.schemaVersion !== SCHEMA_VERSION || !Array.isArray(this.index.workspaces)) {
			this.index = emptyIndex();
			await this.writeIndex();
		}
	}

	async loadState(): Promise<LoadedPowerSearchState> {
		const folders = await this.readJson<FoldersFile>(this.foldersPath(), { schemaVersion: SCHEMA_VERSION, folders: [] });
		const ui = await this.readJson<UiFile>(this.uiPath(), {
			schemaVersion: SCHEMA_VERSION,
			selectedFolderId: null,
			rootIsHidden: false,
			rootExpanded: true,
		});
		const searches = await this.readJson<SearchesFile>(this.searchesPath(), { schemaVersion: SCHEMA_VERSION, searches: [] });
		if (folders.schemaVersion !== SCHEMA_VERSION || !Array.isArray(folders.folders)) {
			throw new Error('Unsupported folders.json schema.');
		}
		if (ui.schemaVersion !== SCHEMA_VERSION) {
			throw new Error('Unsupported ui.json schema.');
		}
		if (searches.schemaVersion !== SCHEMA_VERSION || !Array.isArray(searches.searches)) {
			throw new Error('Unsupported searches.json schema.');
		}

		const loadedFolders = folders.folders.map((folder) => deserializeFolder(folder));
		await this.loadFolderReferencesIntoTree(loadedFolders);
		return {
			folders: loadedFolders,
			selectedFolderId: ui.selectedFolderId,
			rootColor: ui.rootColor,
			rootIsHidden: ui.rootIsHidden ?? false,
			rootExpanded: ui.rootExpanded ?? true,
			searches: searches.searches,
		};
	}

	async getLocalConfig(): Promise<LocalConfig> {
		return validateLocalConfig(await this.readJson<LocalConfig>(this.localPath(), {
			version: LOCAL_CONFIG_VERSION,
			workspaceRoots: this.workspaceRoots,
		}));
	}

	async updateLocalConfig(config: LocalConfig): Promise<LocalConfig> {
		const validated = validateLocalConfig(config);
		await assertWorkspaceRootsExist(validated.workspaceRoots);
		this.workspaceRoots = validated.workspaceRoots;
		await this.writeLocalConfig(validated);
		return validated;
	}

	async saveFolders(folders: FolderItem[]): Promise<void> {
		await this.writeJson(this.foldersPath(), {
			schemaVersion: SCHEMA_VERSION,
			folders: folders.map(serializeFolder),
		});
		await this.touchManifest();
	}

	async saveUi(
		selectedFolderId: string | null,
		rootState?: { color?: string; isHidden: boolean; expanded: boolean; },
	): Promise<void> {
		await this.writeJson(this.uiPath(), {
			schemaVersion: SCHEMA_VERSION,
			selectedFolderId,
			rootColor: rootState?.color,
			rootIsHidden: rootState?.isHidden ?? false,
			rootExpanded: rootState?.expanded ?? true,
		});
		await this.touchManifest();
	}

	async saveSearches(searches: SavedSearchData[]): Promise<void> {
		if (searches.length === 0) {
			await this.deleteIfExists(this.searchesPath());
			await this.touchManifest();
			return;
		}
		await this.writeJson(this.searchesPath(), {
			schemaVersion: SCHEMA_VERSION,
			searches,
		});
		await this.touchManifest();
	}

	async getSettings(): Promise<PowerSearchSettings> {
		const settings = await this.loadSettings();
		return {
			defaultFolderColor: settings.defaultFolderColor,
		};
	}

	async ensureFolderDoc(folder: FolderItem): Promise<string> {
		const filePath = this.folderDocPath(folder.id);
		if (!await pathExists(filePath)) {
			await this.writeFile(filePath, [`# ${folder.name}`, '', 'PowerSearch folder notes.', ''].join('\n'));
			await this.touchManifest();
		}
		return filePath;
	}

	async ensureRootDoc(): Promise<string> {
		const filePath = this.rootDocPath();
		if (!await pathExists(filePath)) {
			await this.writeFile(filePath, ['# Folders', '', 'PowerSearch root notes.', ''].join('\n'));
			await this.touchManifest();
		}
		return filePath;
	}

	async removeFolderDocs(folderIds: Iterable<string>): Promise<void> {
		let changed = false;
		for (const folderId of folderIds) {
			const filePath = this.folderDocPath(folderId);
			if (await pathExists(filePath)) {
				await this.deleteIfExists(filePath);
				changed = true;
			}
		}
		if (changed) {
			await this.touchManifest();
		}
	}

	async addRanges(locations: CoreLocation[], folderId: string): Promise<AddRangesResult> {
		return this.runRangeMutation(() => this.addRangesUnlocked(locations, folderId));
	}

	async getRangesForFile(key: WorkspaceFileKey): Promise<StoredRange[]> {
		const shard = await this.loadRangeShard(key);
		return shard.ranges;
	}

	async getDocumentRangesForFile(key: WorkspaceFileKey): Promise<StoredDocumentRange[]> {
		const shard = await this.loadRangeShard(key);
		const shardPath = shardRelativePath(key);
		return shard.ranges.map((storedRange) => ({
			reference: { id: storedRange.id, shard: shardPath },
			storedRange,
		}));
	}

	async resolveReference(reference: StoredRangeReference): Promise<ResolvedReference | undefined> {
		const shard = await this.loadRangeShardByRelativePath(reference.shard);
		if (!shard) {
			return undefined;
		}
		const storedRange = shard.ranges.find((item) => item.id === reference.id);
		if (!storedRange) {
			return undefined;
		}
		const absolutePath = this.workspaceFilePath(shard.workspaceFolder, shard.path);
		if (!absolutePath) {
			return undefined;
		}
		return {
			file: {
				workspaceFolder: shard.workspaceFolder,
				path: shard.path,
			},
			absolutePath,
			storedRange,
		};
	}

	async updateRangeComment(reference: StoredRangeReference, comment: string | undefined): Promise<boolean> {
		return this.runRangeMutation(() => this.updateRangeCommentUnlocked(reference, comment));
	}

	async updateRangesForDocumentChanges(
		previousText: string,
		nextText: string,
		key: WorkspaceFileKey,
		contentChanges: readonly TextContentChange[],
	): Promise<UpdateRangesForDocumentResult> {
		return this.runRangeMutation(() => this.updateRangesForDocumentChangesUnlocked(previousText, nextText, key, contentChanges));
	}

	async duplicateFolderRanges(folderIdMap: Map<string, string>): Promise<DuplicateFolderRangesResult> {
		return this.runRangeMutation(() => this.duplicateFolderRangesUnlocked(folderIdMap));
	}

	async clearRangeCommentsForFolders(folderIds: Set<string>): Promise<boolean> {
		return this.runRangeMutation(() => this.clearRangeCommentsForFoldersUnlocked(folderIds));
	}

	async removeDanglingReference(folderId: string, reference: StoredRangeReference): Promise<void> {
		return this.runRangeMutation(() => this.removeDanglingReferenceUnlocked(folderId, reference));
	}

	async deleteRange(sourceFolderId: string, reference: StoredRangeReference): Promise<DeleteRangeResult> {
		return this.runRangeMutation(() => this.deleteRangeUnlocked(sourceFolderId, reference));
	}

	async moveRanges(requests: MoveRangeRequest[], targetFolderId: string): Promise<MoveRangeResult[]> {
		return this.runRangeMutation(() => this.moveRangesUnlocked(requests, targetFolderId));
	}

	async removeRangesForFolders(folderIds: Set<string>): Promise<void> {
		return this.runRangeMutation(() => this.removeRangesForFoldersUnlocked(folderIds));
	}

	async clearAll(): Promise<void> {
		return this.runRangeMutation(() => this.clearAllUnlocked());
	}

	keyForAbsolutePath(filePath: string): WorkspaceFileKey | undefined {
		const normalizedFilePath = path.resolve(filePath);
		for (const root of this.workspaceRoots) {
			const relative = path.relative(root.path, normalizedFilePath);
			if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
				return {
					workspaceFolder: root.name,
					path: normalizePortablePath(relative),
				};
			}
		}
		return undefined;
	}

	workspaceFilePath(workspaceFolderName: string, relativePath: string): string | undefined {
		const workspaceRoot = this.workspaceRoots.find((folder) => folder.name === workspaceFolderName);
		if (!workspaceRoot) {
			return undefined;
		}
		return path.join(workspaceRoot.path, ...relativePath.split('/'));
	}

	private async addRangesUnlocked(locations: CoreLocation[], folderId: string): Promise<AddRangesResult> {
		const grouped = new Map<string, { key: WorkspaceFileKey; ranges: RangeData[] }>();
		for (const location of locations) {
			const cacheKey = fileCacheKey(location.key);
			const entry = grouped.get(cacheKey) ?? { key: location.key, ranges: [] };
			entry.ranges.push(location.range);
			grouped.set(cacheKey, entry);
		}

		let added = 0;
		const addedReferences: StoredRangeReference[] = [];
		for (const entry of grouped.values()) {
			const shard = await this.loadRangeShard(entry.key);
			const shardPath = shardRelativePath(entry.key);
			const existingRanges = new Set(shard.ranges.map(rangeIdentity));
			let shardChanged = false;
			for (const range of entry.ranges) {
				const storedRange = cloneRangeData(range);
				const identity = rangeIdentity({ folderId, range: storedRange });
				if (existingRanges.has(identity)) {
					continue;
				}
				const id = createId('rng');
				shard.ranges.push({
					id,
					folderId,
					range: storedRange,
				});
				addedReferences.push({ id, shard: shardPath });
				existingRanges.add(identity);
				added += 1;
				shardChanged = true;
			}
			if (shardChanged) {
				await this.saveRangeShard(shard);
			}
		}

		if (addedReferences.length > 0) {
			await this.addFolderReferences(folderId, addedReferences);
			await this.writeIndex();
			await this.touchManifest();
		}

		return { added, addedReferences, skippedOutsideWorkspace: 0 };
	}

	private async updateRangeCommentUnlocked(reference: StoredRangeReference, comment: string | undefined): Promise<boolean> {
		const shard = await this.loadRangeShardByRelativePath(reference.shard);
		if (!shard) {
			return false;
		}
		const storedRange = shard.ranges.find((item) => item.id === reference.id);
		if (!storedRange) {
			return false;
		}
		const nextComment = comment && comment.length > 0 ? comment : undefined;
		if (storedRange.comment === nextComment) {
			return false;
		}
		storedRange.comment = nextComment;
		await this.saveRangeShard(shard);
		await this.touchManifest();
		return true;
	}

	private async updateRangesForDocumentChangesUnlocked(
		previousText: string,
		nextText: string,
		key: WorkspaceFileKey,
		contentChanges: readonly TextContentChange[],
	): Promise<UpdateRangesForDocumentResult> {
		if (contentChanges.length === 0 || !this.findIndexEntry(key)) {
			return { changed: false, removedReferences: [] };
		}

		const shard = await this.loadRangeShard(key);
		if (shard.ranges.length === 0) {
			return { changed: false, removedReferences: [] };
		}

		const orderedChanges = [...contentChanges]
			.filter((change) => change.rangeLength > 0 || change.text.length > 0)
			.sort((left, right) => right.rangeOffset - left.rangeOffset);
		if (orderedChanges.length === 0) {
			return { changed: false, removedReferences: [] };
		}

		const shardPath = shardRelativePath(key);
		const nextRanges: StoredRange[] = [];
		const removedReferences: StoredRangeReference[] = [];
		let changed = false;
		const previousLineOffsets = computeLineOffsets(previousText);
		const nextLineOffsets = computeLineOffsets(nextText);
		for (const storedRange of shard.ranges) {
			const nextRange = transformStoredRange(previousText, previousLineOffsets, nextText, nextLineOffsets, storedRange, orderedChanges);
			if (!nextRange) {
				removedReferences.push({ id: storedRange.id, shard: shardPath });
				await this.removeFolderReference(storedRange.folderId, { id: storedRange.id, shard: shardPath });
				changed = true;
				continue;
			}
			if (!sameRangeData(storedRange.range, nextRange.range)) {
				changed = true;
			}
			nextRanges.push(nextRange);
		}

		if (!changed) {
			return { changed: false, removedReferences: [] };
		}

		shard.ranges = nextRanges;
		if (shard.ranges.length === 0) {
			await this.deleteRangeShard(shard);
		}
		else {
			await this.saveRangeShard(shard);
		}
		if (removedReferences.length > 0) {
			await this.writeIndex();
		}
		await this.touchManifest();
		return {
			changed: true,
			removedReferences,
		};
	}

	private async duplicateFolderRangesUnlocked(folderIdMap: Map<string, string>): Promise<DuplicateFolderRangesResult> {
		const addedReferencesByFolderId = new Map<string, StoredRangeReference[]>();
		if (folderIdMap.size === 0) {
			return { addedReferencesByFolderId };
		}

		let changed = false;
		for (const workspace of this.index.workspaces) {
			for (const file of workspace.files) {
				const shard = await this.loadRangeShard({ workspaceFolder: workspace.workspaceFolder, path: file.path });
				const shardPath = shardRelativePath(shard);
				const additions: StoredRange[] = [];
				for (const storedRange of shard.ranges) {
					const newFolderId = folderIdMap.get(storedRange.folderId);
					if (!newFolderId) {
						continue;
					}
					const duplicatedRange: StoredRange = {
						...storedRange,
						id: createId('rng'),
						folderId: newFolderId,
						range: cloneRangeData(storedRange.range),
						comment: storedRange.comment,
					};
					additions.push(duplicatedRange);
					const references = addedReferencesByFolderId.get(newFolderId) ?? [];
					references.push({ id: duplicatedRange.id, shard: shardPath });
					addedReferencesByFolderId.set(newFolderId, references);
				}
				if (additions.length === 0) {
					continue;
				}
				shard.ranges.push(...additions);
				await this.saveRangeShard(shard);
				changed = true;
			}
		}

		for (const [folderId, references] of addedReferencesByFolderId) {
			await this.addFolderReferences(folderId, references);
		}
		if (changed) {
			await this.writeIndex();
			await this.touchManifest();
		}
		return { addedReferencesByFolderId };
	}

	private async clearRangeCommentsForFoldersUnlocked(folderIds: Set<string>): Promise<boolean> {
		if (folderIds.size === 0) {
			return false;
		}

		let changed = false;
		for (const workspace of this.index.workspaces) {
			for (const file of workspace.files) {
				const shard = await this.loadRangeShard({ workspaceFolder: workspace.workspaceFolder, path: file.path });
				let shardChanged = false;
				for (const storedRange of shard.ranges) {
					if (!folderIds.has(storedRange.folderId) || !storedRange.comment) {
						continue;
					}
					storedRange.comment = undefined;
					shardChanged = true;
					changed = true;
				}
				if (shardChanged) {
					await this.saveRangeShard(shard);
				}
			}
		}
		if (changed) {
			await this.touchManifest();
		}
		return changed;
	}

	private async removeDanglingReferenceUnlocked(folderId: string, reference: StoredRangeReference): Promise<void> {
		const changed = await this.removeFolderReference(folderId, reference);
		if (!changed) {
			return;
		}
		await this.touchManifest();
	}

	private async deleteRangeUnlocked(sourceFolderId: string, reference: StoredRangeReference): Promise<DeleteRangeResult> {
		const shard = await this.loadRangeShardByRelativePath(reference.shard);
		if (!shard) {
			const removedFromIndex = await this.removeFolderReference(sourceFolderId, reference);
			if (removedFromIndex) {
				await this.touchManifest();
			}
			return {
				removed: removedFromIndex,
				prunedDangling: true,
			};
		}

		const storedRange = shard.ranges.find((item) => item.id === reference.id);
		const actualFolderId = storedRange?.folderId;
		const removedFromSource = await this.removeFolderReference(sourceFolderId, reference);
		const removedFromActual = actualFolderId && actualFolderId !== sourceFolderId
			? await this.removeFolderReference(actualFolderId, reference)
			: false;

		if (!storedRange) {
			if (removedFromSource || removedFromActual) {
				await this.touchManifest();
			}
			return {
				removed: removedFromSource || removedFromActual,
				prunedDangling: true,
			};
		}

		shard.ranges = shard.ranges.filter((item) => item.id !== reference.id);
		if (shard.ranges.length === 0) {
			await this.deleteRangeShard(shard);
		}
		else {
			await this.saveRangeShard(shard);
		}
		await this.writeIndex();
		await this.touchManifest();
		return {
			removed: true,
			prunedDangling: false,
		};
	}

	private async moveRangesUnlocked(requests: MoveRangeRequest[], targetFolderId: string): Promise<MoveRangeResult[]> {
		const results: MoveRangeResult[] = [];
		for (const request of requests) {
			results.push(await this.moveRangeUnlocked(request.sourceFolderId, request.reference, targetFolderId));
		}
		return results;
	}

	private async moveRangeUnlocked(sourceFolderId: string, reference: StoredRangeReference, targetFolderId: string): Promise<MoveRangeResult> {
		if (sourceFolderId === targetFolderId) {
			return {
				outcome: 'unchanged',
				reference,
			};
		}

		const shard = await this.loadRangeShardByRelativePath(reference.shard);
		if (!shard) {
			const removedFromIndex = await this.removeFolderReference(sourceFolderId, reference);
			if (removedFromIndex) {
				await this.touchManifest();
			}
			return { outcome: 'missing' };
		}

		const storedRange = shard.ranges.find((item) => item.id === reference.id);
		if (!storedRange) {
			const removedFromIndex = await this.removeFolderReference(sourceFolderId, reference);
			if (removedFromIndex) {
				await this.touchManifest();
			}
			return { outcome: 'missing' };
		}

		const actualSourceFolderId = storedRange.folderId;
		const sourceReference = { id: storedRange.id, shard: reference.shard };
		const removedFromRequested = await this.removeFolderReference(sourceFolderId, sourceReference);
		const removedFromActual = actualSourceFolderId !== sourceFolderId
			? await this.removeFolderReference(actualSourceFolderId, sourceReference)
			: false;

		if (actualSourceFolderId === targetFolderId) {
			const addedToTarget = await this.addFolderReferences(targetFolderId, [sourceReference]);
			if (removedFromRequested || removedFromActual || addedToTarget) {
				await this.touchManifest();
			}
			return {
				outcome: 'moved',
				reference: sourceReference,
			};
		}

		const duplicate = shard.ranges.find((item) =>
			item.id !== storedRange.id
			&& item.folderId === targetFolderId
			&& sameRangeData(item.range, storedRange.range),
		);
		if (duplicate) {
			shard.ranges = shard.ranges.filter((item) => item.id !== storedRange.id);
			await this.addFolderReferences(targetFolderId, [{ id: duplicate.id, shard: reference.shard }]);
			if (shard.ranges.length === 0) {
				await this.deleteRangeShard(shard);
			}
			else {
				await this.saveRangeShard(shard);
			}
			await this.writeIndex();
			await this.touchManifest();
			return {
				outcome: 'deduplicated',
				reference: {
					id: duplicate.id,
					shard: reference.shard,
				},
			};
		}

		storedRange.folderId = targetFolderId;
		await this.addFolderReferences(targetFolderId, [sourceReference]);
		await this.saveRangeShard(shard);
		await this.writeIndex();
		await this.touchManifest();
		return {
			outcome: 'moved',
			reference: sourceReference,
		};
	}

	private async removeRangesForFoldersUnlocked(folderIds: Set<string>): Promise<void> {
		if (folderIds.size === 0) {
			return;
		}

		for (const folderId of folderIds) {
			await this.deleteFolderRanges(folderId);
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
		}
		await this.touchManifest();
	}

	private async clearAllUnlocked(): Promise<void> {
		await fs.rm(this.storageRootPath(), { recursive: true, force: true });
		this.index = emptyIndex();
		this.rangeCache.clear();
		this.rangeShardPathCache.clear();
		this.folderRangesCache.clear();
		await this.initialize();
	}

	private runRangeMutation<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.rangeMutationQueue.then(operation, operation);
		this.rangeMutationQueue = run.then(() => undefined, () => undefined);
		return run;
	}

	private async loadFolderReferencesIntoTree(folders: FolderItem[]): Promise<void> {
		for (const folder of folders) {
			folder.references = await this.loadFolderReferences(folder);
			await this.loadFolderReferencesIntoTree(folder.children);
		}
	}

	private async loadFolderReferences(folder: FolderItem): Promise<ReturnType<typeof createReferenceItem>[]> {
		const index = await this.loadFolderRanges(folder.id);
		const shardCache = new Map<string, RangeShardFile | undefined>();
		const references: ReturnType<typeof createReferenceItem>[] = [];
		const seen = new Set<string>();
		let changed = false;

		for (const reference of index.ranges) {
			const identity = referenceKey(reference);
			if (seen.has(identity)) {
				changed = true;
				continue;
			}
			seen.add(identity);

			let shard = shardCache.get(reference.shard);
			if (shard === undefined && !shardCache.has(reference.shard)) {
				shard = await this.loadRangeShardByRelativePath(reference.shard);
				shardCache.set(reference.shard, shard);
			}
			if (!shard || !shard.ranges.some((item) => item.id === reference.id)) {
				changed = true;
				continue;
			}

			references.push(createReferenceItem({ ...reference, parent: folder }));
		}

		if (changed) {
			index.ranges = references.map(({ id, shard }) => ({ id, shard }));
			await this.saveFolderRanges(index);
		}
		return references;
	}

	private async addFolderReferences(folderId: string, references: StoredRangeReference[]): Promise<boolean> {
		if (references.length === 0) {
			return false;
		}
		const index = await this.loadFolderRanges(folderId);
		const seen = new Set(index.ranges.map(referenceKey));
		let changed = false;
		for (const reference of references) {
			const identity = referenceKey(reference);
			if (seen.has(identity)) {
				continue;
			}
			index.ranges.push(reference);
			seen.add(identity);
			changed = true;
		}
		if (!changed) {
			return false;
		}
		await this.saveFolderRanges(index);
		return true;
	}

	private async loadFolderRanges(folderId: string): Promise<FolderRangesFile> {
		const cached = this.folderRangesCache.get(folderId);
		if (cached) {
			return cloneFolderRanges(cached);
		}

		const ranges = await this.readJson<FolderRangesFile>(this.folderRangesPath(folderId), emptyFolderRanges(folderId));
		if (ranges.schemaVersion !== SCHEMA_VERSION || ranges.folderId !== folderId || !Array.isArray(ranges.ranges)) {
			const empty = emptyFolderRanges(folderId);
			this.folderRangesCache.set(folderId, empty);
			return cloneFolderRanges(empty);
		}
		this.folderRangesCache.set(folderId, ranges);
		return cloneFolderRanges(ranges);
	}

	private async saveFolderRanges(ranges: FolderRangesFile): Promise<void> {
		this.folderRangesCache.set(ranges.folderId, cloneFolderRanges(ranges));
		if (ranges.ranges.length === 0) {
			await this.deleteIfExists(this.folderRangesPath(ranges.folderId));
			return;
		}
		await this.writeJson(this.folderRangesPath(ranges.folderId), ranges);
	}

	private async deleteFolderRanges(folderId: string): Promise<void> {
		this.folderRangesCache.delete(folderId);
		await this.deleteIfExists(this.folderRangesPath(folderId));
	}

	private async removeFolderReference(folderId: string, reference: StoredRangeReference): Promise<boolean> {
		const index = await this.loadFolderRanges(folderId);
		const nextRanges = index.ranges.filter((item) => !sameStoredRangeReference(item, reference));
		if (nextRanges.length === index.ranges.length) {
			return false;
		}
		index.ranges = nextRanges;
		await this.saveFolderRanges(index);
		return true;
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
		if (!indexEntry) {
			this.rangeCache.set(cacheKey, emptyShard);
			return emptyShard;
		}

		const shard = await this.loadRangeShardByRelativePath(indexEntry.shard);
		if (!shard) {
			this.removeIndexEntry(key);
			await this.writeIndex();
			this.rangeCache.set(cacheKey, emptyShard);
			return emptyShard;
		}
		return shard;
	}

	private async loadRangeShardByRelativePath(shardPath: string): Promise<RangeShardFile | undefined> {
		const cached = this.rangeShardPathCache.get(shardPath);
		if (cached) {
			return cached;
		}

		const shard = await this.readJson<RangeShardFile | undefined>(this.relativePath(shardPath), undefined);
		if (!shard) {
			return undefined;
		}
		if (shard.schemaVersion !== SCHEMA_VERSION || !Array.isArray(shard.ranges)) {
			throw new Error(`Unsupported range shard schema for ${shardPath}.`);
		}
		this.rangeShardPathCache.set(shardPath, shard);
		this.rangeCache.set(fileCacheKey(shard), shard);
		return shard;
	}

	private async saveRangeShard(shard: RangeShardFile): Promise<void> {
		const shardPath = shardRelativePath({ workspaceFolder: shard.workspaceFolder, path: shard.path });
		await this.writeJson(this.relativePath(shardPath), shard);
		this.rangeCache.set(fileCacheKey(shard), shard);
		this.rangeShardPathCache.set(shardPath, shard);
		this.upsertIndexEntry(shard, shardPath);
	}

	private async deleteRangeShard(shard: RangeShardFile): Promise<void> {
		const entry = this.findIndexEntry(shard);
		if (entry) {
			await this.deleteIfExists(this.relativePath(entry.shard));
			this.rangeShardPathCache.delete(entry.shard);
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
		await this.writeJson(this.indexPath(), this.index);
	}

	private async touchManifest(): Promise<void> {
		const manifest = await this.readJson<ManifestFile | undefined>(this.manifestPath(), undefined);
		await this.writeManifest(manifest?.createdAt ?? new Date().toISOString());
	}

	private async writeManifest(createdAt: string): Promise<void> {
		await this.writeJson(this.manifestPath(), {
			schemaVersion: SCHEMA_VERSION,
			createdAt,
			updatedAt: new Date().toISOString(),
			storageWorkspace: this.options.storageLocationLabel,
			workspaces: this.options.workspaces,
		});
	}

	private async ensureSettings(): Promise<void> {
		const fallback: SettingsFile = {
			schemaVersion: SCHEMA_VERSION,
			defaultFolderColor: DEFAULT_FOLDER_COLOR,
		};
		if (!await pathExists(this.settingsPath())) {
			await this.writeSettings(fallback);
			return;
		}
		const settings = await this.readJson<SettingsFile>(this.settingsPath(), fallback);
		if (settings.schemaVersion !== SCHEMA_VERSION || !isValidHexColor(settings.defaultFolderColor)) {
			await this.writeSettings(fallback);
		}
	}

	private async loadSettings(): Promise<SettingsFile> {
		const settings = await this.readJson<SettingsFile>(this.settingsPath(), {
			schemaVersion: SCHEMA_VERSION,
			defaultFolderColor: DEFAULT_FOLDER_COLOR,
		});
		if (settings.schemaVersion !== SCHEMA_VERSION || !isValidHexColor(settings.defaultFolderColor)) {
			return {
				schemaVersion: SCHEMA_VERSION,
				defaultFolderColor: DEFAULT_FOLDER_COLOR,
			};
		}
		return settings;
	}

	private async writeSettings(settings: SettingsFile): Promise<void> {
		await this.writeJson(this.settingsPath(), settings);
	}

	private async writeLocalConfig(config: LocalConfig): Promise<void> {
		await this.writeJson(this.localPath(), config);
	}

	private async readJson<T>(filePath: string, fallback: T): Promise<T> {
		try {
			const data = await fs.readFile(filePath, 'utf8');
			return JSON.parse(data) as T;
		}
		catch (error) {
			if (isFileNotFoundError(error)) {
				return fallback;
			}
			throw error;
		}
	}

	private async writeJson(filePath: string, data: unknown): Promise<void> {
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
	}

	private async writeFile(filePath: string, contents: string): Promise<void> {
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, contents, 'utf8');
	}

	private async deleteIfExists(filePath: string): Promise<void> {
		await fs.rm(filePath, { force: true });
	}

	private storageRootPath(): string {
		return this.options.storageRoot;
	}

	private manifestPath(): string {
		return this.relativePath(MANIFEST_FILE);
	}

	private foldersPath(): string {
		return this.relativePath(FOLDERS_FILE);
	}

	private searchesPath(): string {
		return this.relativePath(SEARCHES_FILE);
	}

	private uiPath(): string {
		return this.relativePath(UI_FILE);
	}

	private settingsPath(): string {
		return this.relativePath(SETTINGS_FILE);
	}

	private localPath(): string {
		return this.relativePath(LOCAL_FILE);
	}

	private indexPath(): string {
		return this.relativePath(FILES_INDEX);
	}

	private folderRangesDirectoryPath(): string {
		return this.relativePath(FOLDER_RANGES_DIRECTORY);
	}

	private folderDocsDirectoryPath(): string {
		return this.relativePath(DOCS_DIRECTORY);
	}

	private folderRangesPath(folderId: string): string {
		return this.relativePath(folderRangesRelativePath(folderId));
	}

	private folderDocPath(folderId: string): string {
		return this.relativePath(`${DOCS_DIRECTORY}/${folderId}.md`);
	}

	private rootDocPath(): string {
		return this.relativePath(`${DOCS_DIRECTORY}/root.md`);
	}

	private relativePath(relativePath: string): string {
		return path.join(this.storageRootPath(), ...relativePath.split('/'));
	}
}

export function validateLocalConfig(config: unknown): LocalConfig {
	if (!config || typeof config !== 'object') {
		throw new Error('local.json must be an object.');
	}
	const candidate = config as Partial<LocalConfig>;
	if (candidate.version !== LOCAL_CONFIG_VERSION) {
		throw new Error(`Unsupported local.json version. Expected ${LOCAL_CONFIG_VERSION}.`);
	}
	if (!Array.isArray(candidate.workspaceRoots)) {
		throw new Error('local.json workspaceRoots must be an array.');
	}

	const seen = new Set<string>();
	const workspaceRoots: WorkspaceRoot[] = [];
	for (const [index, root] of candidate.workspaceRoots.entries()) {
		if (!root || typeof root !== 'object') {
			throw new Error(`local.json workspaceRoots[${index}] must be an object.`);
		}
		const name = (root as Partial<WorkspaceRoot>).name;
		const rootPath = (root as Partial<WorkspaceRoot>).path;
		if (typeof name !== 'string' || name.trim().length === 0) {
			throw new Error(`local.json workspaceRoots[${index}].name must be a non-empty string.`);
		}
		if (seen.has(name)) {
			throw new Error(`local.json contains duplicate workspace root name "${name}".`);
		}
		if (typeof rootPath !== 'string' || !path.isAbsolute(rootPath)) {
			throw new Error(`local.json workspaceRoots[${index}].path must be an absolute path.`);
		}
		seen.add(name);
		workspaceRoots.push({ name, path: path.resolve(rootPath) });
	}

	return {
		version: LOCAL_CONFIG_VERSION,
		workspaceRoots,
	};
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
	if (folder.inheritsColor) {
		data.inheritsColor = true;
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
		inheritsColor: data.inheritsColor ?? false,
		children: [],
		references: [],
		isHidden: data.isHidden ?? false,
		expanded: data.expanded,
		parent,
	});
	folder.children = data.children.map((child) => deserializeFolder(child, folder));
	return folder;
}

function emptyIndex(): FileIndex {
	return {
		schemaVersion: SCHEMA_VERSION,
		updatedAt: new Date().toISOString(),
		workspaces: [],
	};
}

function emptyFolderRanges(folderId: string): FolderRangesFile {
	return {
		schemaVersion: SCHEMA_VERSION,
		folderId,
		ranges: [],
	};
}

function cloneFolderRanges(ranges: FolderRangesFile): FolderRangesFile {
	return {
		...ranges,
		ranges: [...ranges.ranges],
	};
}

function fileCacheKey(key: WorkspaceFileKey): string {
	return `${key.workspaceFolder}\0${key.path}`;
}

function shardRelativePath(key: WorkspaceFileKey): string {
	const digest = crypto.createHash('sha1').update(fileCacheKey(key)).digest('hex');
	return `ranges/${encodeURIComponent(key.workspaceFolder)}/${digest.slice(0, 2)}/${digest}.json`;
}

function folderRangesRelativePath(folderId: string): string {
	const digest = crypto.createHash('sha1').update(folderId).digest('hex');
	return `${FOLDER_RANGES_DIRECTORY}/${digest.slice(0, 2)}/${digest}.json`;
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

function sameRangeData(left: RangeData, right: RangeData): boolean {
	return left.start.line === right.start.line
		&& left.start.character === right.start.character
		&& left.end.line === right.end.line
		&& left.end.character === right.end.character;
}

function transformStoredRange(
	previousText: string,
	previousLineOffsets: number[],
	nextText: string,
	nextLineOffsets: number[],
	storedRange: StoredRange,
	contentChanges: readonly TextContentChange[],
): StoredRange | undefined {
	let startOffset = offsetAtInText(previousText, previousLineOffsets, storedRange.range.start);
	let endOffset = offsetAtInText(previousText, previousLineOffsets, storedRange.range.end);

	for (const change of contentChanges) {
		const changeStart = change.rangeOffset;
		const changeEnd = change.rangeOffset + change.rangeLength;
		const insertedLength = change.text.length;
		if (change.rangeLength === 0) {
			if (changeStart <= startOffset) {
				startOffset += insertedLength;
				endOffset += insertedLength;
			}
			else if (changeStart < endOffset) {
				endOffset += insertedLength;
			}
			continue;
		}

		const delta = insertedLength - change.rangeLength;
		startOffset = transformRangeStartOffset(startOffset, changeStart, changeEnd, delta);
		endOffset = transformRangeEndOffset(endOffset, changeStart, changeEnd, delta, insertedLength);
	}

	startOffset = Math.max(0, Math.min(startOffset, nextText.length));
	endOffset = Math.max(startOffset, Math.min(endOffset, nextText.length));
	if (startOffset === endOffset) {
		return undefined;
	}

	return {
		...storedRange,
		range: {
			start: positionAtInText(nextText, nextLineOffsets, startOffset),
			end: positionAtInText(nextText, nextLineOffsets, endOffset),
		},
	};
}

function transformRangeStartOffset(offset: number, changeStart: number, changeEnd: number, delta: number): number {
	if (offset < changeStart) {
		return offset;
	}
	if (offset >= changeEnd) {
		return offset + delta;
	}
	return changeStart;
}

function transformRangeEndOffset(
	offset: number,
	changeStart: number,
	changeEnd: number,
	delta: number,
	insertedLength: number,
): number {
	if (offset <= changeStart) {
		return offset;
	}
	if (offset >= changeEnd) {
		return offset + delta;
	}
	return changeStart + insertedLength;
}

function computeLineOffsets(text: string): number[] {
	const offsets = [0];
	for (let index = 0; index < text.length; index += 1) {
		if (text.charCodeAt(index) === 10) {
			offsets.push(index + 1);
		}
	}
	return offsets;
}

function offsetAtInText(text: string, lineOffsets: number[], position: PositionData): number {
	const line = Math.max(0, Math.min(position.line, lineOffsets.length - 1));
	const lineStart = lineOffsets[line];
	const lineEnd = line + 1 < lineOffsets.length ? lineOffsets[line + 1] - 1 : text.length;
	return Math.max(lineStart, Math.min(lineStart + position.character, lineEnd));
}

function positionAtInText(text: string, lineOffsets: number[], offset: number): PositionData {
	const boundedOffset = Math.max(0, Math.min(offset, text.length));
	let low = 0;
	let high = lineOffsets.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		if (lineOffsets[middle] > boundedOffset) {
			high = middle - 1;
		}
		else {
			low = middle + 1;
		}
	}
	const line = Math.max(0, low - 1);
	return {
		line,
		character: boundedOffset - lineOffsets[line],
	};
}

function cloneRangeData(range: RangeData): RangeData {
	return {
		start: { ...range.start },
		end: { ...range.end },
	};
}

function normalizePortablePath(value: string): string {
	return value.split(path.sep).join('/');
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	}
	catch {
		return false;
	}
}

async function assertWorkspaceRootsExist(workspaceRoots: readonly WorkspaceRoot[]): Promise<void> {
	for (const root of workspaceRoots) {
		let stat;
		try {
			stat = await fs.stat(root.path);
		}
		catch (error) {
			if (isFileNotFoundError(error)) {
				throw new Error(`local.json workspace root "${root.name}" does not exist: ${root.path}`);
			}
			throw error;
		}
		if (!stat.isDirectory()) {
			throw new Error(`local.json workspace root "${root.name}" is not a directory: ${root.path}`);
		}
	}
}

function isFileNotFoundError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isValidHexColor(value: string): boolean {
	return /^#[0-9A-Fa-f]{6}$/.test(value);
}
