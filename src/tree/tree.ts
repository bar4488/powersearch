import * as vscode from 'vscode';
import { ReferenceItem, TagItem, TreeNode } from './tag-item';
import { createDecorationFromColor, getPreviewChunks } from '../utils';
import { disposeDecorations, updateDecorations } from '../decorator';
import { dumpTree, parseTree } from './tree_parser';

export class TagsTreeDataProvider implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode> {

	private readonly _listener: vscode.Disposable;
	private readonly _onDidChange = new vscode.EventEmitter<undefined>();

	readonly onDidChangeTreeData = this._onDidChange.event;

	constructor(private children: TreeNode[]) {
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
		let idx = 0;
		if (target !== undefined && target.type !== 'tag') {
			if (target.parent === undefined) {
				idx = this.children.indexOf(target);
			}
			else {
				idx = target.parent.references.indexOf(target);
			}
			target = target.parent;
		}
		let targetTag: TagItem = target as TagItem;
		let node = parseTree(transferItem.value, targetTag);
		updateDecorations([node]);
		if (target === undefined) {
			this.children.splice(idx, 0, node);
		}
		else {
			targetTag.references.splice(idx, 0, node);
			targetTag.references = targetTag.references.filter((t) => t.type === 'tag').concat(targetTag.references.filter((t) => t.type === 'ref'));
		}
		this.updateTree();
	}

	public async handleDrag(source: TreeNode[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
		if (source.length !== 1 || source[0].type !== 'tag') {
			return;
		}
		let node = source[0];
		let sourceData = dumpTree(node);
		const parent = node.parent;
		const idx = parent ? parent.references.indexOf(node) : this.children.indexOf(node);
		this.removeNode(node);
		treeDataTransfer.set('application/powersearch', new vscode.DataTransferItem(sourceData));
		token.onCancellationRequested((_) => {
			// canceled, return everything to how it was.
			if (parent) {
				parent.references.splice(idx, 0, node);
				updateDecorations([node]);
			}
		});
	}

	dispose(): void {
		this._onDidChange.dispose();
		this._listener.dispose();
	}

	private updateTree() {

		this._onDidChange.fire(undefined);
	}

	public getNodes() {
		return this.children;
	}

	public addNode(node: TreeNode) {
		this.children.push(node);
		this.updateTree();
	}

	public removeNode(node: TreeNode) {
		disposeDecorations([node]);
		if (!!node.parent) {
			node.parent.references = node.parent.references.filter((t) => t !== node);
		}
		else {
			this.children = this.children.filter((t) => t !== node);
		}
		this.updateTree();
	}

	async getTreeItem(element: TreeNode) {
		if (element.type === 'tag') {
			// files
			const result = new vscode.TreeItem(element.name);
			result.contextValue = 'visible-tag-item';
			result.description = true;
			result.iconPath = vscode.ThemeIcon.File;
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
			return this.children;
		}
		if (element.type === 'tag') {
			return element.references;
		}
		return undefined;
	}

	getParent(element: TreeNode) {
		return element.parent;
	}
}


