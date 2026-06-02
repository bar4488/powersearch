import * as vscode from 'vscode';
import {
	AddRangesResult,
	DeleteRangeResult,
	DuplicateFolderRangesResult,
	LoadedPowerSearchState,
	MoveRangeRequest,
	MoveRangeResult,
	PowerSearchCore,
	PowerSearchSettings,
	ResolvedReference as CoreResolvedReference,
	STORAGE_DIRECTORY,
	StoredDocumentRange,
	UpdateRangesForDocumentResult,
	WorkspaceFileKey,
} from './core/storage_core';
import { FolderItem, SavedSearchData, StoredRange, StoredRangeReference, rangeFromData, rangeToData } from './tree/tree_item';

const STORAGE_LOCATION_STATE_KEY = 'storageLocationUri';

export {
	AddRangesResult,
	DeleteRangeResult,
	DuplicateFolderRangesResult,
	LoadedPowerSearchState,
	MoveRangeRequest,
	MoveRangeResult,
	PowerSearchSettings,
	StoredDocumentRange,
	UpdateRangesForDocumentResult,
	WorkspaceFileKey,
};

export interface ResolvedReference {
	location: vscode.Location;
	storedRange: StoredRange;
}

export class PowerSearchStorage {
	private constructor(
		private readonly core: PowerSearchCore,
		private readonly storageLocation: vscode.Uri,
	) { }

	static async configureStorageLocation(context: vscode.ExtensionContext): Promise<boolean> {
		const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
		if (workspaceFolders.length === 0) {
			void vscode.window.showWarningMessage('PowerSearch requires an open workspace folder to persist data.');
			return false;
		}

		const location = await pickStorageLocation(workspaceFolders, 'Choose the folder PowerSearch should use for storage');
		if (!location) {
			return false;
		}

		await context.workspaceState.update(STORAGE_LOCATION_STATE_KEY, location.toString());
		return true;
	}

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

		const configuredLocation = context.workspaceState.get<string>(STORAGE_LOCATION_STATE_KEY);
		if (configuredLocation) {
			const configuredUri = vscode.Uri.parse(configuredLocation);
			return PowerSearchStorage.openAtLocation(context, workspaceFolders, configuredUri, {
				allowRecovery: true,
				failureMessage: `PowerSearch could not use the configured storage location at ${configuredUri.fsPath}.`,
			});
		}

		const storageLocation = await chooseStorageLocation(context, workspaceFolders);
		if (!storageLocation) {
			void vscode.window.showWarningMessage('PowerSearch storage was not configured. Choose a folder for PowerSearch data.');
			return undefined;
		}

		return PowerSearchStorage.openAtLocation(context, workspaceFolders, storageLocation, {
			allowRecovery: true,
			failureMessage: `PowerSearch could not create or write its storage data in ${storageLocation.fsPath}.`,
		});
	}

	private static async openAtLocation(
		context: vscode.ExtensionContext,
		workspaceFolders: readonly vscode.WorkspaceFolder[],
		storageLocation: vscode.Uri,
		options: { allowRecovery: boolean; failureMessage: string; },
	): Promise<PowerSearchStorage | undefined> {
		const core = new PowerSearchCore({
			storageRoot: storageLocation.fsPath,
			storageLocationLabel: storageLocation.fsPath,
			workspaces: workspaceFolders.map((folder) => ({ id: folder.name, name: folder.name })),
			workspaceRoots: workspaceFolders.map((folder) => ({ name: folder.name, path: folder.uri.fsPath })),
		});
		const storage = new PowerSearchStorage(core, storageLocation);

		try {
			await core.initialize();
			await context.workspaceState.update(STORAGE_LOCATION_STATE_KEY, storageLocation.toString());
			return storage;
		}
		catch (error) {
			if (!options.allowRecovery || !isStorageLocationErrorRecoverable(error)) {
				throw error;
			}

			const retryChoice = await vscode.window.showWarningMessage(
				`${options.failureMessage} Choose another folder for PowerSearch storage.`,
				'Choose Folder',
			);
			if (retryChoice !== 'Choose Folder') {
				return undefined;
			}

			const fallbackLocation = await pickStorageLocation(
				workspaceFolders,
				'Choose the folder PowerSearch should use for storage',
				storageLocation,
			);
			if (!fallbackLocation) {
				return undefined;
			}

			return PowerSearchStorage.openAtLocation(context, workspaceFolders, fallbackLocation, {
				allowRecovery: false,
				failureMessage: `PowerSearch could not create or write its storage data in ${fallbackLocation.fsPath}.`,
			});
		}
	}

	async loadState(): Promise<LoadedPowerSearchState> {
		try {
			return await this.core.loadState();
		}
		catch (error) {
			void vscode.window.showWarningMessage(`PowerSearch could not load .powersearch data: ${error instanceof Error ? error.message : String(error)}`);
			return {
				folders: [],
				selectedFolderId: null,
				rootIsHidden: false,
				rootExpanded: true,
				searches: [],
			};
		}
	}

	async saveFolders(folders: FolderItem[]): Promise<void> {
		return this.core.saveFolders(folders);
	}

	async saveUi(
		selectedFolderId: string | null,
		rootState?: { color?: string; isHidden: boolean; expanded: boolean; },
	): Promise<void> {
		return this.core.saveUi(selectedFolderId, rootState);
	}

	async saveSearches(searches: SavedSearchData[]): Promise<void> {
		return this.core.saveSearches(searches);
	}

	async getSettings(): Promise<PowerSearchSettings> {
		return this.core.getSettings();
	}

	async ensureFolderDoc(folder: FolderItem): Promise<vscode.Uri> {
		return vscode.Uri.file(await this.core.ensureFolderDoc(folder));
	}

	async ensureRootDoc(): Promise<vscode.Uri> {
		return vscode.Uri.file(await this.core.ensureRootDoc());
	}

	async removeFolderDocs(folderIds: Iterable<string>): Promise<void> {
		return this.core.removeFolderDocs(folderIds);
	}

	async addRanges(locations: vscode.Location[], folderId: string): Promise<AddRangesResult> {
		const coreLocations = [];
		let skippedOutsideWorkspace = 0;
		for (const location of locations) {
			const key = this.keyForUri(location.uri);
			if (!key) {
				skippedOutsideWorkspace += 1;
				continue;
			}
			coreLocations.push({
				key,
				range: rangeToData(location.range),
			});
		}

		const result = await this.core.addRanges(coreLocations, folderId);
		return {
			...result,
			skippedOutsideWorkspace: result.skippedOutsideWorkspace + skippedOutsideWorkspace,
		};
	}

	async getRangesForDocument(uri: vscode.Uri): Promise<StoredRange[]> {
		const key = this.keyForUri(uri);
		if (!key) {
			return [];
		}
		return this.core.getRangesForFile(key);
	}

	async getDocumentRanges(uri: vscode.Uri): Promise<StoredDocumentRange[]> {
		const key = this.keyForUri(uri);
		if (!key) {
			return [];
		}
		return this.core.getDocumentRangesForFile(key);
	}

	async resolveReferenceLocation(reference: StoredRangeReference): Promise<vscode.Location | undefined> {
		const resolved = await this.resolveReference(reference);
		return resolved?.location;
	}

	async resolveReference(reference: StoredRangeReference): Promise<ResolvedReference | undefined> {
		const resolved = await this.core.resolveReference(reference);
		return resolved ? toResolvedReference(resolved) : undefined;
	}

	async updateRangeComment(reference: StoredRangeReference, comment: string | undefined): Promise<boolean> {
		return this.core.updateRangeComment(reference, comment);
	}

	async updateRangesForDocumentChanges(
		previousText: string,
		document: vscode.TextDocument,
		contentChanges: readonly vscode.TextDocumentContentChangeEvent[],
	): Promise<UpdateRangesForDocumentResult> {
		const key = this.keyForUri(document.uri);
		if (!key) {
			return { changed: false, removedReferences: [] };
		}
		return this.core.updateRangesForDocumentChanges(
			previousText,
			document.getText(),
			key,
			contentChanges.map((change) => ({
				rangeOffset: change.rangeOffset,
				rangeLength: change.rangeLength,
				text: change.text,
			})),
		);
	}

	async duplicateFolderRanges(folderIdMap: Map<string, string>): Promise<DuplicateFolderRangesResult> {
		return this.core.duplicateFolderRanges(folderIdMap);
	}

	async clearRangeCommentsForFolders(folderIds: Set<string>): Promise<boolean> {
		return this.core.clearRangeCommentsForFolders(folderIds);
	}

	async removeDanglingReference(folderId: string, reference: StoredRangeReference): Promise<void> {
		return this.core.removeDanglingReference(folderId, reference);
	}

	async deleteRange(sourceFolderId: string, reference: StoredRangeReference): Promise<DeleteRangeResult> {
		return this.core.deleteRange(sourceFolderId, reference);
	}

	async moveRanges(requests: MoveRangeRequest[], targetFolderId: string): Promise<MoveRangeResult[]> {
		return this.core.moveRanges(requests, targetFolderId);
	}

	async removeRangesForFolders(folderIds: Set<string>): Promise<void> {
		return this.core.removeRangesForFolders(folderIds);
	}

	async clearAll(): Promise<void> {
		return this.core.clearAll();
	}

	getWorkspaceRelativePath(uri: vscode.Uri): WorkspaceFileKey | undefined {
		return this.keyForUri(uri);
	}

	private keyForUri(uri: vscode.Uri): WorkspaceFileKey | undefined {
		if (uri.scheme !== 'file') {
			return undefined;
		}
		return this.core.keyForAbsolutePath(uri.fsPath);
	}
}

async function chooseStorageLocation(
	context: vscode.ExtensionContext,
	workspaceFolders: readonly vscode.WorkspaceFolder[],
): Promise<vscode.Uri | undefined> {
	const existingLocations: vscode.Uri[] = [];
	for (const folder of workspaceFolders) {
		const defaultLocation = defaultWorkspaceStorageRoot(folder.uri);
		if (await isStorageRoot(defaultLocation)) {
			existingLocations.push(defaultLocation);
		}
	}

	if (existingLocations.length === 1) {
		return existingLocations[0];
	}

	if (workspaceFolders.length === 1 && existingLocations.length === 0) {
		return defaultWorkspaceStorageRoot(workspaceFolders[0].uri);
	}

	if (existingLocations.length > 1) {
		const pickedExisting = await vscode.window.showQuickPick(existingLocations.map((uri) => ({
			label: vscode.workspace.asRelativePath(uri, false),
			description: uri.fsPath,
			uri,
		})), {
			placeHolder: 'Multiple PowerSearch folders were found. Choose one or cancel to pick a different location.',
		});
		if (pickedExisting) {
			return pickedExisting.uri;
		}
	}

	const initialValue = context.workspaceState.get<string>(STORAGE_LOCATION_STATE_KEY);
	const initialUri = initialValue
		? vscode.Uri.parse(initialValue)
		: workspaceFolders[0]?.uri;
	return pickStorageLocation(workspaceFolders, 'Choose the folder PowerSearch should use for storage', initialUri);
}

async function pickStorageLocation(
	workspaceFolders: readonly vscode.WorkspaceFolder[],
	title: string,
	defaultUri?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
	const selected = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		title,
		openLabel: 'Use This Folder',
		defaultUri: defaultUri ?? workspaceFolders[0]?.uri,
	});
	return selected?.[0];
}

function defaultWorkspaceStorageRoot(workspaceUri: vscode.Uri): vscode.Uri {
	return vscode.Uri.joinPath(workspaceUri, STORAGE_DIRECTORY);
}

async function isStorageRoot(uri: vscode.Uri): Promise<boolean> {
	return await exists(vscode.Uri.joinPath(uri, 'manifest.json'))
		|| await exists(vscode.Uri.joinPath(uri, 'folders.json'));
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

function toResolvedReference(resolved: CoreResolvedReference): ResolvedReference {
	return {
		location: new vscode.Location(vscode.Uri.file(resolved.absolutePath), rangeFromData(resolved.storedRange.range)),
		storedRange: resolved.storedRange,
	};
}

function isStorageLocationErrorRecoverable(error: unknown): boolean {
	return error instanceof Error;
}
