import * as vscode from 'vscode';
import { DecorationManager } from './decorator';
import { PowerSearchStorage, StoredDocumentRange } from './storage';
import { FoldersTreeDataProvider } from './tree/tree';
import { FolderItem, ReferenceItem, SavedSearchData, SearchScope, TreeNode, VisibleRootItem, createFolderItem, createId, rangeFromData } from './tree/tree_item';
import { getPreviewChunks, isValidColor } from './utils';

const defaultColors = [
	{ name: 'Navy', value: '#001f3f' },
	{ name: 'Blue', value: '#0074D9' },
	{ name: 'Aqua', value: '#7FDBFF' },
	{ name: 'Teal', value: '#39CCCC' },
	{ name: 'Purple', value: '#B10DC9' },
	{ name: 'Fuchsia', value: '#F012BE' },
	{ name: 'Maroon', value: '#85144b' },
	{ name: 'Red', value: '#FF4136' },
	{ name: 'Orange', value: '#FF851B' },
	{ name: 'Yellow', value: '#FFDC00' },
	{ name: 'Olive', value: '#3D9970' },
	{ name: 'Green', value: '#2ECC40' },
	{ name: 'Lime', value: '#01FF70' },
	{ name: 'Black', value: '#111111' },
	{ name: 'Gray', value: '#AAAAAA' },
	{ name: 'Silver', value: '#DDDDDD' },
	{ name: 'White', value: '#FFFFFF' },
];

type ColorTarget = FolderItem | VisibleRootItem;
export interface SearchDraft {
	pattern: string;
	isRegex: boolean;
	isCaseSensitive: boolean;
	isWholeWord: boolean;
	scope: SearchScope;
	workspaceNames?: string[];
	includes?: string;
	excludes?: string;
}

export interface SearchFormState {
	pattern: string;
	isRegex: boolean;
	isCaseSensitive: boolean;
	isWholeWord: boolean;
	scope: SearchScope;
	workspaceNames: string[];
	includes: string;
	excludes: string;
}

export interface SearchFolderOption {
	id: string;
	label: string;
	description?: string;
	isTarget: boolean;
}

export interface SearchResultItem {
	id: string;
	path: string;
	line: number;
	preview: string;
}

export interface SearchRunResult {
	results: SearchResultItem[];
	resultCount: number;
	fileCount: number;
}

interface SearchResultEntry extends SearchResultItem {
	location: vscode.Location;
}

export class TreeController {
	private lastSearchResults: SearchResultEntry[] = [];

	constructor(
		private readonly tree: FoldersTreeDataProvider,
		private readonly storage: PowerSearchStorage,
		private readonly decorations: DecorationManager,
	) { }

	public async onColorSymbol() {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('Open an editor before coloring a symbol.');
			return;
		}

		const doc = editor.document;
		const basePosition = editor.selection.anchor;
		const baseRange = doc.getWordRangeAtPosition(basePosition);
		if (!baseRange) {
			vscode.window.showWarningMessage('No symbol found at the current cursor position.');
			return;
		}

		const refs = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', doc.uri, basePosition) ?? [];
		if (refs.length === 0) {
			vscode.window.showWarningMessage('No references found for the selected symbol.');
			return;
		}

		const folder = createFolderItem({
			name: doc.getText(baseRange),
			color: '#ffff00',
			expanded: true,
			children: [],
			references: [],
		});
		this.tree.addNode(folder);
		this.tree.setSelectedFolder(folder);
		await this.addLocationsToFolder(refs, folder);
	}

	public async onColorSelection() {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('Open an editor before coloring a selection.');
			return;
		}

		const selections = editor.selections.filter((selection) => !selection.isEmpty);
		if (selections.length === 0) {
			vscode.window.showWarningMessage('Select text before coloring a selection.');
			return;
		}

		const folder = await this.requireTargetFolder();
		if (!folder) {
			return;
		}

		await this.addLocationsToFolder(
			selections.map((selection) => new vscode.Location(editor.document.uri, selection)),
			folder,
		);
	}

	public async onColorLine() {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('Open an editor before coloring a line.');
			return;
		}

		const folder = await this.requireTargetFolder();
		if (!folder) {
			return;
		}

		const lineRange = editor.document.lineAt(editor.selection.anchor.line).range;
		await this.addLocationsToFolder([new vscode.Location(editor.document.uri, lineRange)], folder);
	}

	public async onChooseTargetFolder(folder?: FolderItem) {
		const pickedFolder = folder ?? await this.pickFolder('Choose the current target folder.', true);
		if (pickedFolder) {
			this.tree.setSelectedFolder(pickedFolder);
		}
	}

	public async onClearTargetFolder(folder?: FolderItem) {
		if (folder && this.tree.getSelectedFolderId() !== folder.id) {
			return;
		}
		this.tree.setSelectedFolder(undefined);
	}

	public async onChangeFolderColor(target: ColorTarget) {
		const choices = target.type === 'foldersRoot'
			? [...defaultColors.map((option) => option.name), 'Custom', 'None']
			: [...defaultColors.map((option) => option.name), 'Parent', 'Custom', 'None'];
		const choice = await vscode.window.showQuickPick(
			choices,
			{ placeHolder: `Choose a color mode for ${target.name}` },
		);
		if (!choice) {
			return;
		}

		if (choice === 'None') {
			if (target.type === 'foldersRoot') {
				this.tree.setRootColor(undefined);
			}
			else {
				this.tree.setFolderColor(target, undefined, false);
			}
			await this.decorations.updateVisibleEditors();
			return;
		}

		if (choice === 'Parent') {
			if (target.type === 'foldersRoot') {
				return;
			}
			this.tree.setFolderColor(target, undefined, true);
			await this.decorations.updateVisibleEditors();
			return;
		}

		const idx = defaultColors.map((option) => option.name).indexOf(choice);
		let color: string;
		if (idx === -1) {
			color = await vscode.window.showInputBox({ prompt: 'Write a color in #xxxxxx format' });
			if (!isValidColor(color)) {
				vscode.window.showWarningMessage('Invalid color format.');
				return;
			}
		}
		else {
			color = defaultColors[idx].value;
		}

		if (target.type === 'foldersRoot') {
			this.tree.setRootColor(color);
		}
		else {
			this.tree.setFolderColor(target, color, false);
		}
		await this.decorations.updateVisibleEditors();
	}

	public async onRenameFolder(folder: FolderItem) {
		const newName = await vscode.window.showInputBox({ prompt: 'Enter folder name', value: folder.name });
		if (!newName) {
			return;
		}

		folder.name = newName;
		this.tree.updateNode(folder);
	}

	public async onOpenFolderDoc(folder?: FolderItem | VisibleRootItem) {
		const target = folder ?? this.tree.getSelectedFolder();
		if (!target) {
			vscode.window.showWarningMessage('Choose a folder before opening folder notes.');
			return;
		}
		const uri = target.type === 'foldersRoot'
			? await this.storage.ensureRootDoc()
			: await this.storage.ensureFolderDoc(target);
		await vscode.commands.executeCommand('vscode.open', uri);
	}

	public async onSelectNode(node: TreeNode) {
		await this.tree.selectNode(node);
	}

	public async onRemoveFolder(folder: FolderItem) {
		const removedFolderIds = this.tree.removeNode(folder);
		await this.storage.removeFolderDocs(removedFolderIds);
		await this.storage.removeRangesForFolders(removedFolderIds);
		await this.decorations.updateVisibleEditors();
	}

	public async onDeleteRange(reference: ReferenceItem) {
		const sourceFolder = reference.parent;
		if (!sourceFolder) {
			return;
		}

		const choice = await vscode.window.showWarningMessage(
			'Delete this range from PowerSearch?',
			{ modal: true },
			'Delete Range',
		);
		if (choice !== 'Delete Range') {
			return;
		}

		const result = await this.storage.deleteRange(sourceFolder.id, reference);
		this.tree.removeReference(reference);
		if (result.removed) {
			await this.decorations.updateVisibleEditors();
		}
	}

	public async onEditRangeComment(reference?: ReferenceItem) {
		const target = reference
			? await this.resolveCommentTargetFromReference(reference)
			: await this.resolveCommentTargetAtCursor();
		if (!target) {
			return;
		}

		const value = await vscode.window.showInputBox({
			prompt: 'Edit range comment',
			value: target.storedRange.comment ?? '',
			placeHolder: 'Shown inline as a colored // comment. Leave empty to clear.',
		});
		if (value === undefined) {
			return;
		}

		const comment = normalizeRangeComment(value);
		const changed = await this.storage.updateRangeComment(target.reference, comment);
		if (!changed) {
			return;
		}
		this.tree.refreshTree();
		await this.decorations.updateVisibleEditors();
	}

	public async onRevealCurrentRange(reveal: (reference: ReferenceItem) => Thenable<void>) {
		const target = await this.resolveCommentTargetAtCursor();
		if (!target) {
			return;
		}
		const reference = this.tree.getReference(target.reference);
		if (!reference) {
			vscode.window.showWarningMessage('Could not find the current PowerSearch range in the folders tree.');
			return;
		}
		await reveal(reference);
	}

	public async onAddFolder(parent?: FolderItem | VisibleRootItem) {
		const folder = await this.createFolder(parent);
		if (folder) {
			this.tree.setSelectedFolder(folder);
		}
	}

	public async onToggleFolderVisibility(target: FolderItem | VisibleRootItem) {
		if (target.type === 'foldersRoot') {
			this.tree.toggleRootVisibility();
		}
		else {
			this.tree.toggleVisibility(target);
		}
		await this.decorations.updateVisibleEditors();
	}

	private async requireTargetFolder(): Promise<FolderItem | undefined> {
		return this.tree.getSelectedFolder() ?? this.pickFolder('Choose where new ranges should be stored.', true);
	}

	private async resolveCommentTargetFromReference(reference: ReferenceItem): Promise<StoredDocumentRange | undefined> {
		const resolved = await this.storage.resolveReference(reference);
		if (resolved) {
			return {
				reference: { id: reference.id, shard: reference.shard },
				storedRange: resolved.storedRange,
			};
		}
		if (reference.parent) {
			await this.storage.removeDanglingReference(reference.parent.id, reference);
			this.tree.removeReference(reference);
		}
		return undefined;
	}

	private async resolveCommentTargetAtCursor(): Promise<StoredDocumentRange | undefined> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('Open an editor before editing a range comment.');
			return undefined;
		}

		const visibleDecoratedFolders = this.tree.getVisibleColoredFolders();
		const cursor = editor.selection.active;
		const candidates = (await this.storage.getDocumentRanges(editor.document.uri)).filter((entry) =>
			visibleDecoratedFolders.has(entry.storedRange.folderId)
			&& rangeFromData(entry.storedRange.range).contains(cursor),
		);
		if (candidates.length === 0) {
			vscode.window.showWarningMessage('No visible decorated PowerSearch range found at the cursor.');
			return undefined;
		}
		if (candidates.length > 1) {
			vscode.window.showWarningMessage('Cannot edit a range comment when multiple visible decorated ranges overlap the cursor.');
			return undefined;
		}
		return candidates[0];
	}

	private async createFolder(parent?: FolderItem | VisibleRootItem, initialName?: string): Promise<FolderItem | undefined> {
		const newName = initialName ?? await vscode.window.showInputBox({ prompt: 'Enter folder name' });
		if (!newName) {
			return undefined;
		}
		const folder = createFolderItem({ name: newName, children: [], references: [] });
		this.tree.addNode(folder, parent?.type === 'folder' ? parent : undefined);
		return folder;
	}

	private async pickFolder(placeHolder: string, allowCreate: boolean): Promise<FolderItem | undefined> {
		const folders = this.tree.listFolders();
		if (folders.length === 0) {
			if (!allowCreate) {
				vscode.window.showWarningMessage('Create a folder first.');
				return undefined;
			}
			return this.createFolder(undefined, await vscode.window.showInputBox({ prompt: 'No folders yet. Enter the first folder name' }));
		}

		const items: Array<vscode.QuickPickItem & { folder?: FolderItem; create?: boolean }> = folders.map((folder) => ({
			label: folder.name,
			description: this.describeFolder(folder),
			folder,
		}));
		if (allowCreate) {
			items.unshift({
				label: '$(add) New Folder',
				description: 'Create a new top-level folder',
				create: true,
			});
		}

		const choice = await vscode.window.showQuickPick(items, { placeHolder });
		if (!choice) {
			return undefined;
		}
		if (choice.create) {
			return this.createFolder();
		}
		return choice.folder;
	}

	private describeFolder(folder: FolderItem): string | undefined {
		const ancestors: string[] = [];
		let current = folder.parent;
		while (current && current.type !== 'root') {
			ancestors.unshift(current.name);
			current = current.parent;
		}

		const details: string[] = [];
		if (ancestors.length > 0) {
			details.push(ancestors.join(' / '));
		}
		if (this.tree.getSelectedFolderId() === folder.id) {
			details.push('target');
		}
		return details.length > 0 ? details.join(' · ') : undefined;
	}

	public getSearchFolders(): SearchFolderOption[] {
		return this.tree.listFolders().map((folder) => ({
			id: folder.id,
			label: folder.name,
			description: this.describeFolder(folder),
			isTarget: this.tree.getSelectedFolderId() === folder.id,
		}));
	}

	public async runSearch(form: SearchFormState): Promise<SearchRunResult> {
		const search = normalizeSearchDraft(form);
		if (!search) {
			this.lastSearchResults = [];
			return emptySearchRunResult();
		}
		const locations = await this.findMatches(search);
		this.lastSearchResults = await this.buildSearchResults(locations);
		return toSearchRunResult(this.lastSearchResults);
	}

	public async saveLatestSearchResults(folderId: string): Promise<boolean> {
		if (this.lastSearchResults.length === 0) {
			return false;
		}
		const folder = this.tree.getFolder(folderId);
		if (!folder) {
			vscode.window.showWarningMessage('Choose a valid folder before saving search results.');
			return false;
		}
		await this.addLocationsToFolder(this.lastSearchResults.map((result) => result.location), folder);
		return true;
	}

	public dismissSearchResult(resultId: string): SearchRunResult {
		this.lastSearchResults = this.lastSearchResults.filter((result) => result.id !== resultId);
		return toSearchRunResult(this.lastSearchResults);
	}

	public async openSearchResult(resultId: string) {
		const result = this.lastSearchResults.find((entry) => entry.id === resultId);
		if (!result) {
			return;
		}
		const { location } = result;
		await vscode.commands.executeCommand('vscode.open', location.uri, <vscode.TextDocumentShowOptions>{
			selection: location.range,
		});
	}

	public createInitialSearchState(): SearchFormState {
		return {
			pattern: '',
			isRegex: false,
			isCaseSensitive: false,
			isWholeWord: false,
			scope: 'allWorkspaces',
			workspaceNames: [],
			includes: '',
			excludes: '',
		};
	}

	private async findMatches(search: SearchDraft): Promise<vscode.Location[]> {
		const expression = this.createSearchExpression(search);
		if (!expression) {
			return [];
		}
		const locations: vscode.Location[] = [];
		const seen = new Set<string>();
		const pushResult = (uri: vscode.Uri, range: vscode.Range) => {
			const identity = `${uri.toString()}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
			if (seen.has(identity)) {
				return;
			}
			seen.add(identity);
			locations.push(new vscode.Location(uri, range));
		};

		switch (search.scope) {
			case 'currentFile':
				await this.findMatchesInCurrentFile(expression, pushResult);
				break;
			case 'selectedWorkspaces':
				await this.findMatchesInSelectedWorkspaces(search, expression, pushResult);
				break;
			default:
				await this.findMatchesInUris(
					await vscode.workspace.findFiles(search.includes || '**/*', search.excludes || undefined),
					expression,
					pushResult,
				);
				break;
		}

		return locations;
	}

	private async buildSearchResults(locations: vscode.Location[]): Promise<SearchResultEntry[]> {
		const results: SearchResultEntry[] = [];
		for (const location of locations) {
			const path = vscode.workspace.asRelativePath(location.uri, false);
			try {
				const document = await vscode.workspace.openTextDocument(location.uri);
				const { before, inside, after } = getPreviewChunks(document, location.range, 24, true);
				results.push({
					id: createId('res'),
					path,
					line: location.range.start.line + 1,
					preview: `${before}${inside}${after}`,
					location,
				});
			}
			catch {
				results.push({
					id: createId('res'),
					path,
					line: location.range.start.line + 1,
					preview: path,
					location,
				});
			}
		}
		return results;
	}

	private async findMatchesInCurrentFile(expression: RegExp, pushResult: (uri: vscode.Uri, range: vscode.Range) => void) {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('Open a file before searching the current file.');
			return;
		}
		for (const range of this.findRangesInDocument(editor.document, expression)) {
			pushResult(editor.document.uri, range);
		}
	}

	private async findMatchesInSelectedWorkspaces(
		search: SearchDraft,
		expression: RegExp,
		pushResult: (uri: vscode.Uri, range: vscode.Range) => void,
	) {
		for (const workspaceName of search.workspaceNames ?? []) {
			const workspaceFolder = vscode.workspace.workspaceFolders?.find((folder) => folder.name === workspaceName);
			if (!workspaceFolder) {
				continue;
			}
			const uris = await vscode.workspace.findFiles(
				search.includes
					? new vscode.RelativePattern(workspaceFolder, search.includes)
					: new vscode.RelativePattern(workspaceFolder, '**/*'),
				search.excludes
					? new vscode.RelativePattern(workspaceFolder, search.excludes)
					: undefined,
			);
			await this.findMatchesInUris(uris, expression, pushResult);
		}
	}

	private async findMatchesInUris(
		uris: readonly vscode.Uri[],
		expression: RegExp,
		pushResult: (uri: vscode.Uri, range: vscode.Range) => void,
	) {
		for (const uri of uris) {
			try {
				const document = await vscode.workspace.openTextDocument(uri);
				for (const range of this.findRangesInDocument(document, expression)) {
					pushResult(uri, range);
				}
			}
			catch {
				// Ignore unreadable files and continue with the rest of the search set.
			}
		}
	}

	private createSearchExpression(search: SearchDraft): RegExp | undefined {
		const sourcePattern = search.isRegex
			? search.pattern
			: escapeRegExp(search.pattern);
		const pattern = search.isWholeWord
			? `\\b(?:${sourcePattern})\\b`
			: sourcePattern;
		try {
			const flags = search.isCaseSensitive ? 'g' : 'gi';
			return new RegExp(pattern, flags);
		}
		catch (error) {
			vscode.window.showWarningMessage(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	}

	private findRangesInDocument(document: vscode.TextDocument, expression: RegExp): vscode.Range[] {
		const text = document.getText();
		if (!text) {
			return [];
		}
		expression.lastIndex = 0;
		const ranges: vscode.Range[] = [];
		let match: RegExpExecArray | null;
		while ((match = expression.exec(text)) !== null) {
			const value = match[0];
			if (!value) {
				expression.lastIndex += 1;
				continue;
			}
			const start = document.positionAt(match.index);
			const end = document.positionAt(match.index + value.length);
			ranges.push(new vscode.Range(start, end));
		}
		return ranges;
	}

	private async addLocationsToFolder(locations: vscode.Location[], folder: FolderItem): Promise<void> {
		const result = await this.storage.addRanges(locations, folder.id);
		if (result.added > 0) {
			this.tree.addReferences(folder, result.addedReferences);
			await this.decorations.updateVisibleEditors();
		}
		if (result.skippedOutsideWorkspace > 0) {
			vscode.window.showWarningMessage(`Skipped ${result.skippedOutsideWorkspace} reference(s) outside the current workspace.`);
		}
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSearchDraft(form: SearchFormState): SearchDraft | undefined {
	const pattern = form.pattern.trim();
	if (!pattern) {
		return undefined;
	}
	const workspaceNames = form.scope === 'selectedWorkspaces'
		? form.workspaceNames.filter((name) => name.trim().length > 0)
		: undefined;
	return {
		pattern,
		isRegex: form.isRegex,
		isCaseSensitive: form.isCaseSensitive,
		isWholeWord: form.isWholeWord,
		scope: form.scope,
		workspaceNames,
		includes: form.scope === 'currentFile' ? undefined : form.includes.trim() || undefined,
		excludes: form.scope === 'currentFile' ? undefined : form.excludes.trim() || undefined,
	};
}

function toSearchRunResult(results: SearchResultEntry[]): SearchRunResult {
	return {
		results: results.map(({ location: _location, ...result }) => result),
		resultCount: results.length,
		fileCount: new Set(results.map((result) => result.location.uri.toString())).size,
	};
}

function emptySearchRunResult(): SearchRunResult {
	return {
		results: [],
		resultCount: 0,
		fileCount: 0,
	};
}

function normalizeRangeComment(value: string): string | undefined {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
