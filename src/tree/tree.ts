import * as vscode from 'vscode';
import { ReferenceItem, TagItem, TreeNode } from './tag-item';
import { createDecorationFromColor, getPreviewChunks } from '../utils';
import { disposeDecorations, updateDecorations } from '../decorator';

export class TagsTreeDataProvider implements vscode.TreeDataProvider<TreeNode> {

	private readonly _listener: vscode.Disposable;
	private readonly _onDidChange = new vscode.EventEmitter<undefined>();

	readonly onDidChangeTreeData = this._onDidChange.event;

	constructor(private children: TreeNode[]) {
		updateDecorations(children);
		this._onDidChange.fire(undefined);
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
		this.children = this.children.filter((t) => t !== node);
		disposeDecorations([node]);
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


