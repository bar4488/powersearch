import * as vscode from 'vscode';
import { PowerSearchStorage } from '../storage';
import { folderAndAncestorsVisible, folderBadgeText, getPreviewChunks, indicesToNode, nodeToIndices, resolveFolderColor } from '../utils';
import { FolderItem, ParentNode, ReferenceItem, RootItem, StoredRangeReference, TreeNode, VisibleRootItem, createReferenceItem } from './tree_item';

export class FoldersTreeDataProvider implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode> {

	private readonly _onDidChange = new vscode.EventEmitter<undefined>();
	private readonly folderIcon: { light: vscode.Uri; dark: vscode.Uri; };
	private readonly targetFolderIcon: { light: vscode.Uri; dark: vscode.Uri; };
	private readonly rootNoteIcon = new vscode.ThemeIcon('folder-library');

	readonly onDidChangeTreeData = this._onDidChange.event;
	private readonly root: RootItem;
	private readonly foldersRootNode: VisibleRootItem;
	private selectedFolder: FolderItem | undefined;

	constructor(
		children: FolderItem[],
		private readonly storage: PowerSearchStorage,
		private readonly extensionUri: vscode.Uri,
		rootState: { color?: string; isHidden: boolean; expanded: boolean; },
	) {
		this.root = { type: 'root', children, color: rootState.color, isHidden: rootState.isHidden };
		this.foldersRootNode = { type: 'foldersRoot', name: 'Folders', expanded: rootState.expanded, color: rootState.color, isHidden: rootState.isHidden };
		this.folderIcon = {
			light: vscode.Uri.joinPath(this.extensionUri, 'resources', 'folder.svg'),
			dark: vscode.Uri.joinPath(this.extensionUri, 'resources', 'folder.svg'),
		};
		this.targetFolderIcon = {
			light: vscode.Uri.joinPath(this.extensionUri, 'resources', 'folder-target.svg'),
			dark: vscode.Uri.joinPath(this.extensionUri, 'resources', 'folder-target.svg'),
		};
		for (const child of children) {
			child.parent = this.root;
		}
		this.refresh();
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

		const targetNode = target?.type === 'folder'
			? target
			: target?.type === 'foldersRoot'
				? this.root
				: target?.parent ?? this.root;
		if (targetNode === nodes[0].parent) {
			return;
		}
		if (nodes.some((node) => this.containsNode(node, targetNode))) {
			vscode.window.showWarningMessage('Cannot move a folder into itself.');
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
		if (source.length === 0 || source.some((node) => node.type !== 'folder')) {
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

	public getRootState(): { color?: string; isHidden: boolean; expanded: boolean; } {
		return {
			color: this.root.color,
			isHidden: this.root.isHidden,
			expanded: this.foldersRootNode.expanded,
		};
	}

	public hasFolders(): boolean {
		return this.root.children.length > 0;
	}

	public listFolders(): FolderItem[] {
		return this.flattenFolders();
	}

	public getSelectedFolder(): FolderItem | undefined {
		return this.selectedFolder;
	}

	public getSelectedFolderId(): string | null {
		return this.selectedFolder?.id ?? null;
	}

	public restoreSelectedFolder(folderId: string | null) {
		this.selectedFolder = folderId ? this.findFolder(folderId) : undefined;
		this.refresh();
	}

	public setSelectedFolder(folder: FolderItem | undefined) {
		this.selectedFolder = folder;
		if (folder) {
			folder.expanded = true;
		}
		this.updateTree();
	}

	public getFolder(folderId: string): FolderItem | undefined {
		return this.findFolder(folderId);
	}

	public getVisibleColoredFolders(): Map<string, string> {
		const result = new Map<string, string>();
		for (const folder of this.flattenFolders()) {
			const color = resolveFolderColor(folder);
			if (color && folderAndAncestorsVisible(folder)) {
				result.set(folder.id, color);
			}
		}
		return result;
	}

	public clear() {
		this.root.children = [];
		this.selectedFolder = undefined;
		this.root.color = undefined;
		this.root.isHidden = false;
		this.foldersRootNode.color = undefined;
		this.foldersRootNode.isHidden = false;
		this.refresh();
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
		if (node.type === 'foldersRoot') {
			const uri = await this.storage.ensureRootDoc();
			await vscode.commands.executeCommand('vscode.open', uri);
			return;
		}

		if (node.type === 'folder') {
			const uri = await this.storage.ensureFolderDoc(node);
			await vscode.commands.executeCommand('vscode.open', uri);
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
		if (element.type === 'foldersRoot') {
			const result = new vscode.TreeItem(element.name);
			result.contextValue = element.isHidden ? 'hiddenFoldersRoot' : 'foldersRoot';
			result.description = this.root.color ? this.root.color : undefined;
			result.iconPath = this.rootNoteIcon;
			result.collapsibleState = element.expanded
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.Collapsed;
			const lines = ['Root PowerSearch folder actions'];
			if (this.root.color) {
				lines.push(`Default color: ${this.root.color}`);
			}
			if (this.root.isHidden) {
				lines.push('Hidden');
			}
			result.tooltip = lines.join('\n');
			result.command = {
				command: 'powersearch.selectFolder',
				title: 'Open Root Notes',
				arguments: [element],
			};
			return result;
		}

		if (element.type === 'folder') {
			const isTarget = this.selectedFolder?.id === element.id;
			const result = new vscode.TreeItem(element.name);
			result.contextValue = element.isHidden
				? isTarget ? 'hiddenTargetFolder' : 'hiddenFolder'
				: isTarget ? 'targetFolder' : 'visibleFolder';
			result.description = folderBadgeText(element, isTarget);
			result.tooltip = this.buildFolderTooltip(element, isTarget);
			result.iconPath = isTarget ? this.targetFolderIcon : this.folderIcon;
			result.collapsibleState = element.children.length + element.references.length === 0
				? vscode.TreeItemCollapsibleState.None
				: element.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
			result.command = {
				command: 'powersearch.selectFolder',
				title: 'Open Folder Notes',
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

	public setFolderColor(folder: FolderItem, color: string | undefined, inheritsColor: boolean = false) {
		folder.color = color;
		folder.inheritsColor = inheritsColor;
		this.updateTree();
	}

	public setRootColor(color: string | undefined) {
		this.root.color = color;
		this.foldersRootNode.color = color;
		this.updateTree();
	}

	public updateNode(folder: FolderItem) {
		this.updateTree();
	}

	public setExpanded(element: TreeNode, expanded: boolean) {
		if (element.type === 'foldersRoot') {
			if (this.foldersRootNode.expanded === expanded) {
				return;
			}
			this.foldersRootNode.expanded = expanded;
			this.refresh();
			return;
		}
		if (element.type === 'ref' || element.expanded === expanded) {
			return;
		}
		element.expanded = expanded;
		this.updateTree();
	}

	async getChildren(element?: TreeNode) {
		if (element === undefined) {
			return [this.foldersRootNode];
		}
		if (element.type === 'foldersRoot') {
			return this.root.children;
		}
		if (element.type === 'ref') {
			return [];
		}
		return [...element.children, ...element.references];
	}

	getParent(element: TreeNode) {
		if (element.type === 'foldersRoot') {
			return undefined;
		}
		const parent = element.parent;
		return !parent || parent.type === 'root' ? undefined : parent;
	}

	toggleVisibility(item: FolderItem) {
		item.isHidden = !item.isHidden;
		this.updateTree();
	}

	toggleRootVisibility() {
		this.root.isHidden = !this.root.isHidden;
		this.foldersRootNode.isHidden = this.root.isHidden;
		this.updateTree();
	}

	private buildFolderTooltip(folder: FolderItem, isTarget: boolean): string {
		const lines = [folder.name];
		if (isTarget) {
			lines.push('Current target for new ranges');
		}
		if (folder.inheritsColor) {
			lines.push(`Color: Parent${resolveFolderColor(folder) ? ` (${resolveFolderColor(folder)})` : ''}`);
		} else if (folder.color) {
			lines.push(`Color: ${folder.color}`);
		}
		if (folder.isHidden) {
			lines.push('Hidden');
		}
		return lines.join('\n');
	}

	private refresh() {
		void this.syncContexts();
		this._onDidChange.fire(undefined);
	}

	private async syncContexts() {
		await vscode.commands.executeCommand('setContext', 'powersearch.hasFolders', this.hasFolders());
		await vscode.commands.executeCommand('setContext', 'powersearch.hasTargetFolder', !!this.selectedFolder);
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
