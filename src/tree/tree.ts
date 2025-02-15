import * as vscode from 'vscode';
import { ParentNode, ReferenceItem, RootItem, TagItem, TreeNode, createTagItem } from './tag-item';
import { createDecorationFromColor, nodeToIndices, getPreviewChunks, setTagDecoration, indicesToNode } from '../utils';
import { disposeDecorations, updateDecorations } from '../decorator';
import { dumpTree, parseTree } from './tree_parser';
import { RequestListener } from 'http';

export class TagsTreeDataProvider implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode> {

	private readonly _listener: vscode.Disposable;
	private readonly _onDidChange = new vscode.EventEmitter<undefined>();

	readonly onDidChangeTreeData = this._onDidChange.event;
	private root: RootItem;

	private selectedTag: TagItem;

	constructor(children: TreeNode[]) {
		this.root = { type: 'root', references: children };
		for (var child of children) {
			child.parent = this.root;
		}
		updateDecorations(children);
		this._onDidChange.fire(undefined);
	}

	private findOrCreateSelectedTag(){
		for (var element of this.root.references) {
			if (element.type === 'tag' && element.name === 'Default') {
				this.selectedTag = element;
				console.log("found default tag");
			}
		}
		if (this.selectedTag === undefined) {
			this.selectedTag = createTagItem({
				name: "Default", references: [],
			});
			this.addNode(this.selectedTag);
		}
	}

	dropMimeTypes = ['application/powersearch'];
	dragMimeTypes = ['application/powersearch'];

	public async handleDrop(target: TreeNode | undefined, sources: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
		const transferItem = sources.get('application/powersearch');
		if (!transferItem) {
			return;
		}
		const indicesList: number[][] = transferItem.value;
		if (indicesList.length === 0) {
			return;
		}
		// build tree
		let nodes: TreeNode[] = [];
		for (var nodeIndices of transferItem.value) {
			const node = indicesToNode(nodeIndices, this.root);
			nodes.push(node);
		}

		// if target is reference, take parent
		let targetNode = target ?? this.root;
		targetNode = targetNode.type === 'ref' ? targetNode.parent : targetNode;

		if (targetNode === nodes[0].parent) {
			// we do not want to remove anything
			return;
		}
		nodes[0].parent.references = nodes[0].parent.references.filter((n) => !nodes.includes(n));

		targetNode.references.push(...nodes);
		for (let node of nodes) {
			node.parent = targetNode;
		}
		updateDecorations(this.root.references);
		this.updateTree();
	}

	/**
	 * Handles drag event. Only drags where all nodes have the same parent are allowed.
	 * The indices of the dragged nodes are stored in the data transfer object.
	 * @param source The nodes to be dragged.
	 * @param treeDataTransfer The data transfer object.
	 * @param token A cancellation token.
	 */
	public async handleDrag(source: TreeNode[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
		if (source.length === 0) {
			return;
		}
		// allow only drags where all nodes have the same parent
		const p = source[0].parent;
		if (source.filter((n) => n.parent !== p).length !== 0) {
			return;
		}

		// calculate indices
		let sourceIndices = [];
		for (var s of source) {
			let indices = nodeToIndices(s);
			if (indices === undefined) {
				continue;
			}
			sourceIndices.push(indices);
		}
		treeDataTransfer.set('application/powersearch', new vscode.DataTransferItem(sourceIndices));
	}

	dispose(): void {
		this._onDidChange.dispose();
		this._listener.dispose();
	}

	private updateTree() {
		vscode.commands.executeCommand("powersearch.saveTree");
		this._onDidChange.fire(undefined);
	}

	public getNodes() {
		return this.root.references;
	}

	public addNode(node: TreeNode, parent: ParentNode = undefined) {
		if (parent === undefined) {
			parent = this.root;
		}
		node.parent = parent;
		// push at start of references
		parent.references = [node, ...parent.references];

		if (node.type === 'tag') {
			setTagDecoration(node);
		}
		else if (parent !== this.root) {
			updateDecorations([parent as TagItem]);
		}
		this.updateTree();
	}

	public addNodeToSelectedTag(node: ReferenceItem) {
		if (this.selectedTag === undefined) {
			this.findOrCreateSelectedTag();
		}
		console.log("selected tag: " + this.selectedTag.color);
		node.parent = this.selectedTag;
		this.selectedTag.expanded = true;
		this.selectedTag.references.push(node);
		updateDecorations([this.selectedTag]);
		this.updateTree();
	}

	public removeNode(node: TreeNode) {
		disposeDecorations([node]);
		
		// make sure to remove tag if its a child of the deleted node
		if (this.findInChildren(node, this.selectedTag)) {
			this.selectedTag = undefined;
			console.log("should reselect tag");
		}

		// remove from parent
		if (!!node.parent) {
			node.parent.references = node.parent.references.filter((t) => t !== node);
		}
		else {
			// should not happen
			console.error("node has no parent");
		}
		// update decorations
		if (node.type === "ref" && !!node.parent) {
			updateDecorations([node.parent as TreeNode]);
		}
		this.updateTree();
	}

	private findInChildren(node: TreeNode, searchNode) {
		if (node === searchNode) {
			return true;
		}
		if (node.type === 'ref') {
			return false;
		}
		for (var child of node.references) {
			if (this.findInChildren(child, searchNode)) {
				return true;
			}
		}
		return false;
	}

	public selectTag(element: TreeNode) {
		if (element.type === 'tag') {
			this.selectedTag = element;
			this.selectedTag.expanded = true;
			this.updateTree();
		}
		else {
			const { range } = element.location;
			vscode.commands.executeCommand("vscode.open", element.location.uri, <vscode.TextDocumentShowOptions>{ selection: range.with({ end: range.start }) });
		}
	}

	async getTreeItem(element: TreeNode) {
		let result: vscode.TreeItem;
		if (element.type === 'tag') {
			// files
			result = new vscode.TreeItem(element.name);
			result.contextValue = 'visible-tag-item';
			result.description = true;
			result.iconPath = vscode.ThemeIcon.Folder;
			result.collapsibleState = element.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
			// when a user presses a tag, select it
		} else {
			// references
			const { range } = element.location;
			const doc = await vscode.workspace.openTextDocument(element.location.uri);
			const { before, inside, after } = getPreviewChunks(doc, range);

			const label: vscode.TreeItemLabel = {
				label: before + inside + after,
				highlights: [[before.length, before.length + inside.length]]
			};

			result = new vscode.TreeItem(label);
			result.collapsibleState = vscode.TreeItemCollapsibleState.None;
			result.contextValue = 'tag-occurrence-item';
			result.description = vscode.workspace.asRelativePath(element.location.uri);
			result.tooltip = result.description;
		}
		result.command = {
			command: 'powersearch.selectTag',
			title: "Select Tag",
			arguments: [
				element
			]
		};
		return result;
	}

	public setTagColor(tag: TagItem, color: string) {
		if (!!tag.decoration) {
			tag.decoration.dispose();
			tag.decoration = undefined;
			tag.color = undefined;
		}
		if (color === undefined) {
			return;
		}
		tag.decoration = createDecorationFromColor(color);
		tag.color = color;
		updateDecorations([tag]);
		this.updateTree();
	}

	public updateNode(tag: TagItem) {
		this.updateTree();
	}

	async getChildren(element?: TreeNode) {
		if (element === undefined) {
			return this.root.references;
		}
		if (element.type === 'tag') {
			return element.references;
		}
		return undefined;
	}

	getParent(element: TreeNode) {
		return element.parent.type === 'root' ? undefined : element.parent;
	}
}


