import * as vscode from 'vscode';
import { PowerSearchStorage } from '../storage';
import { folderAndAncestorsVisible, getPreviewChunks, indicesToNode, nodeToIndices } from '../utils';
import { FolderItem, ParentNode, ReferenceItem, RootItem, StoredRangeReference, TreeNode, createFolderItem, createReferenceItem } from './tree_item';

export class FoldersTreeDataProvider implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode> {

	private readonly _onDidChange = new vscode.EventEmitter<undefined>();

	readonly onDidChangeTreeData = this._onDidChange.event;
	private readonly root: RootItem;
	private selectedFolder: FolderItem | undefined;

	constructor(children: FolderItem[], private readonly storage: PowerSearchStorage) {
		this.root = { type: 'root', children };
		for (const child of children) {
			child.parent = this.root;
		}
		this._onDidChange.fire(undefined);
	}

	dropMimeTypes = ['application/powersearch.folder'];
	dragMimeTypes = ['application/powersearch.folder'];

	public async handleDrop(target: TreeNode | undefined, sources: vscode.DataTransfer): Promise<void> {
		const transferItem = sources.get('application/powersearch.folder');
		if (!transferItem) {
			return;
		}
		const indicesList = transferItem.value as number[][];
		if (indicesList.length === 0) {
			return;
		}

		const nodes: FolderItem[] = [];
		for (const nodeIndices of indicesList) {
			const node = indicesToNode(nodeIndices, this.root);
			if (!node) {
				return;
			}
			nodes.push(node);
		}

		const targetNode = target?.type === 'folder' ? target : target?.parent ?? this.root;
		if (targetNode === nodes[0].parent) {
			return;
		}
		if (nodes.some((node) => this.containsNode(node, targetNode))) {
			vscode.window.showWarningMessage("Cannot move a folder into itself.");
			return;
		}

		nodes[0].parent.children = nodes[0].parent.children.filter((node) => !nodes.includes(node));
		targetNode.children.push(...nodes);
		for (const node of nodes) {
			node.parent = targetNode;
		}
		this.updateTree();
	}

	public async handleDrag(source: TreeNode[], treeDataTransfer: vscode.DataTransfer): Promise<void> {
		if (source.length === 0) {
			return;
		}
		if (source.some((node) => node.type !== 'folder')) {
			return;
		}

		const folders = source as FolderItem[];
		const parent = folders[0].parent;
		if (folders.some((node) => node.parent !== parent)) {
			return;
		}

		const sourceIndices = folders
			.map((node) => nodeToIndices(node))
			.filter((indices): indices is number[] => indices !== undefined);
		treeDataTransfer.set('application/powersearch.folder', new vscode.DataTransferItem(sourceIndices));
	}

	dispose(): void {
		this._onDidChange.dispose();
	}

	public getNodes(): FolderItem[] {
		return this.root.children;
	}

	public getSelectedFolderId(): string | null {
		return this.selectedFolder?.id ?? null;
	}

	public restoreSelectedFolder(folderId: string | null) {
		if (!folderId) {
			return;
		}
		this.selectedFolder = this.findFolder(folderId);
	}

	public getOrCreateSelectedFolder(): FolderItem {
		if (this.selectedFolder) {
			return this.selectedFolder;
		}
		const existingDefault = this.root.children.find((folder) => folder.name === 'Default');
		if (existingDefault) {
			this.selectedFolder = existingDefault;
			return existingDefault;
		}
		const defaultFolder = createFolderItem({ name: 'Default', color: '#ffff00', children: [], references: [], expanded: true });
		this.addNode(defaultFolder);
		this.selectedFolder = defaultFolder;
		return defaultFolder;
	}

	public getFolder(folderId: string): FolderItem | undefined {
		return this.findFolder(folderId);
	}

	public getVisibleColoredFolders(): Map<string, string> {
		const result = new Map<string, string>();
		for (const folder of this.flattenFolders()) {
			if (folder.color && folderAndAncestorsVisible(folder)) {
				result.set(folder.id, folder.color);
			}
		}
		return result;
	}

	public clear() {
		this.root.children = [];
		this.selectedFolder = undefined;
		this._onDidChange.fire(undefined);
	}

	public addNode(node: FolderItem, parent: ParentNode = this.root) {
		node.parent = parent;
		parent.children = [node, ...parent.children];
		this.updateTree();
	}

	public addReferences(folder: FolderItem, references: StoredRangeReference[]) {
		if (references.length === 0) {
			return;
		}
		folder.expanded = true;
		folder.references.push(...references.map((reference) => createReferenceItem({ ...reference, parent: folder })));
		this.refresh();
	}

	public removeNode(node: FolderItem): Set<string> {
		const removedFolderIds = new Set(this.flattenFolders(node).map((folder) => folder.id));
		if (this.selectedFolder && removedFolderIds.has(this.selectedFolder.id)) {
			this.selectedFolder = undefined;
		}
		node.parent.children = node.parent.children.filter((child) => child !== node);
		this.updateTree();
		return removedFolderIds;
	}

	public async selectNode(node: TreeNode) {
		if (node.type === 'folder') {
			this.selectedFolder = node;
			this.selectedFolder.expanded = true;
			this.updateTree();
			return;
		}

		const location = await this.storage.resolveReferenceLocation(node);
		if (!location) {
			await this.pruneDanglingReference(node);
			return;
		}

		try {
			await vscode.commands.executeCommand('vscode.open', location.uri, <vscode.TextDocumentShowOptions>{ selection: location.range.with({ end: location.range.start }) });
		}
		catch {
			vscode.window.showWarningMessage(`Could not open reference: ${vscode.workspace.asRelativePath(location.uri)}`);
		}
	}

	async getTreeItem(element: TreeNode) {
		if (element.type === 'folder') {
			const result = new vscode.TreeItem(element.name);
			result.contextValue = element.isHidden ? 'hiddenFolder' : 'visibleFolder';
			result.description = element.color;
			result.iconPath = new vscode.ThemeIcon('folder');
			result.collapsibleState = element.children.length + element.references.length === 0
				? vscode.TreeItemCollapsibleState.None
				: element.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
			result.command = {
				command: 'powersearch.selectFolder',
				title: 'Select Folder',
				arguments: [element],
			};
			return result;
		}

		const location = await this.storage.resolveReferenceLocation(element);
		if (!location) {
			return new vscode.TreeItem('Missing reference');
		}

		let result: vscode.TreeItem;
		const description = vscode.workspace.asRelativePath(location.uri, false);
		try {
			const doc = await vscode.workspace.openTextDocument(location.uri);
			const { before, inside, after } = getPreviewChunks(doc, location.range);
			const label: vscode.TreeItemLabel = {
				label: before + inside + after,
				highlights: [[before.length, before.length + inside.length]],
			};
			result = new vscode.TreeItem(label);
		}
		catch {
			result = new vscode.TreeItem(`Missing reference: ${description}`);
		}
		result.collapsibleState = vscode.TreeItemCollapsibleState.None;
		result.contextValue = 'reference';
		result.description = description;
		result.tooltip = description;
		result.command = {
			command: 'powersearch.selectFolder',
			title: 'Open Reference',
			arguments: [element],
		};
		return result;
	}

	public setFolderColor(folder: FolderItem, color: string | undefined) {
		folder.color = color;
		this.updateTree();
	}

	public updateNode(folder: FolderItem) {
		this.updateTree();
	}

	public setExpanded(element: FolderItem, expanded: boolean) {
		if (element.expanded === expanded) {
			return;
		}
		element.expanded = expanded;
		this.updateTree();
	}

	async getChildren(element?: TreeNode) {
		if (element === undefined) {
			return this.root.children;
		}
		if (element.type === 'ref') {
			return [];
		}
		return [...element.children, ...element.references];
	}

	getParent(element: TreeNode) {
		const parent = element.parent;
		return !parent || parent.type === 'root' ? undefined : parent;
	}

	toggleVisibility(item: FolderItem) {
		item.isHidden = !item.isHidden;
		this.updateTree();
	}

	private refresh() {
		this._onDidChange.fire(undefined);
	}

	private updateTree() {
		void vscode.commands.executeCommand('powersearch.saveTree');
		this.refresh();
	}

	private async pruneDanglingReference(reference: ReferenceItem): Promise<void> {
		const parent = reference.parent;
		if (!parent) {
			return;
		}
		await this.storage.removeDanglingReference(parent.id, reference);
		parent.references = parent.references.filter((item) => item !== reference);
		this.refresh();
	}

	private findFolder(folderId: string): FolderItem | undefined {
		return this.flattenFolders().find((folder) => folder.id === folderId);
	}

	private flattenFolders(root: FolderItem | RootItem = this.root): FolderItem[] {
		const children = root.children;
		return children.flatMap((folder) => [folder, ...this.flattenFolders(folder)]);
	}

	private containsNode(node: FolderItem, searchNode: FolderItem | RootItem) {
		if (node === searchNode) {
			return true;
		}
		return node.children.some((child) => this.containsNode(child, searchNode));
	}
}
