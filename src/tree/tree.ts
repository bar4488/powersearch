import * as vscode from 'vscode';
import { ReferenceItem, RootItem, TagItem, TreeNode } from './tag-item';
import { createDecorationFromColor, findIndices, getPreviewChunks } from '../utils';
import { disposeDecorations, updateDecorations } from '../decorator';
import { dumpTree, parseTree } from './tree_parser';

export class TagsTreeDataProvider implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode> {

	private readonly _listener: vscode.Disposable;
	private readonly _onDidChange = new vscode.EventEmitter<undefined>();

	readonly onDidChangeTreeData = this._onDidChange.event;
	private root: RootItem;

	constructor(children: TreeNode[]) {
		this.root = {type: 'root', references: children};
		for (var child of children) {
			child.parent = this.root;
		}
		updateDecorations(children);
		this._onDidChange.fire(undefined);
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
			let curr: TreeNode = null;
			let childs = this.root.references;
			for (var idx of nodeIndices) {
				curr = childs[idx];
				childs = (curr as TagItem).references;
			}
			nodes.push(curr);
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
			let indices = findIndices(s);
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

	public addNode(node: TreeNode) {
		this.root.references.push(node);
		this.updateTree();
	}

	public removeNode(node: TreeNode) {
		disposeDecorations([node]);
		if (!!node.parent) {
			node.parent.references = node.parent.references.filter((t) => t !== node);
		}
		else {
			this.root.references = this.root.references.filter((t) => t !== node);
		}
		this.updateTree();
	}

	async getTreeItem(element: TreeNode) {
		if (element.type === 'tag') {
			// files
			const result = new vscode.TreeItem(element.name);
			result.contextValue = 'visible-tag-item';
			result.description = true;
			result.iconPath = vscode.ThemeIcon.Folder;
			result.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
			result.command = {
				command: 'vscode.open',
				title: vscode.l10n.t('Open Reference'),
				arguments: [
					element.location.uri,
					<vscode.TextDocumentShowOptions>{ selection: element.location.range.with({ end: element.location.range.start }) }
				]
			};
			return result;
		} else {
			// references
			const { range } = element.location;
			const doc = await vscode.workspace.openTextDocument(element.location.uri);
			const { before, inside, after } = getPreviewChunks(doc, range);

			const label: vscode.TreeItemLabel = {
				label: before + inside + after,
				highlights: [[before.length, before.length + inside.length]]
			};

			const result = new vscode.TreeItem(label);
			result.collapsibleState = vscode.TreeItemCollapsibleState.None;
			result.contextValue = 'tag-occurrence-item';
			result.description = vscode.workspace.asRelativePath(element.location.uri);
			result.tooltip = result.description;
			result.command = {
				command: 'vscode.open',
				title: vscode.l10n.t('Open Reference'),
				arguments: [
					element.location.uri,
					<vscode.TextDocumentShowOptions>{ selection: range.with({ end: range.start }) }
				]
			};
			return result;
		}
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


