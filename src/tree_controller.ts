import * as vscode from 'vscode';
import { DecorationManager } from './decorator';
import { PowerSearchStorage } from './storage';
import { FoldersTreeDataProvider } from './tree/tree';
import { FolderItem, TreeNode, createFolderItem } from './tree/tree_item';
import { isValidColor } from './utils';

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

export class TreeController {
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

		const selection = editor.selection;
		if (selection.isEmpty) {
			vscode.window.showWarningMessage('Select text before coloring a selection.');
			return;
		}

		const folder = await this.requireTargetFolder();
		if (!folder) {
			return;
		}

		await this.addLocationsToFolder([new vscode.Location(editor.document.uri, selection)], folder);
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

	public async onChangeFolderColor(folder: FolderItem) {
		const choice = await vscode.window.showQuickPick(
			[...defaultColors.map((option) => option.name), 'Parent', 'Custom', 'None'],
			{ placeHolder: `Choose a color mode for ${folder.name}` },
		);
		if (!choice) {
			return;
		}

		if (choice === 'None') {
			this.tree.setFolderColor(folder, undefined, false);
			await this.decorations.updateVisibleEditors();
			return;
		}

		if (choice === 'Parent') {
			this.tree.setFolderColor(folder, undefined, true);
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

		this.tree.setFolderColor(folder, color, false);
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

	public async onOpenFolderDoc(folder?: FolderItem) {
		const target = folder ?? this.tree.getSelectedFolder();
		if (!target) {
			vscode.window.showWarningMessage('Choose a folder before opening folder notes.');
			return;
		}
		const uri = await this.storage.ensureFolderDoc(target);
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

	public async onAddFolder(parent?: FolderItem) {
		const folder = await this.createFolder(parent);
		if (folder) {
			this.tree.setSelectedFolder(folder);
		}
	}

	public async onToggleFolderVisibility(folder: FolderItem) {
		this.tree.toggleVisibility(folder);
		await this.decorations.updateVisibleEditors();
	}

	private async requireTargetFolder(): Promise<FolderItem | undefined> {
		return this.tree.getSelectedFolder() ?? this.pickFolder('Choose where new ranges should be stored.', true);
	}

	private async createFolder(parent?: FolderItem, initialName?: string): Promise<FolderItem | undefined> {
		const newName = initialName ?? await vscode.window.showInputBox({ prompt: 'Enter folder name' });
		if (!newName) {
			return undefined;
		}
		const folder = createFolderItem({ name: newName, children: [], references: [] });
		this.tree.addNode(folder, parent);
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
				label: '$(add) Create folder',
				description: 'Create a new root folder',
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
