import * as vscode from 'vscode';
import { ReferenceItem, TagItem } from './tag-item';
import { getPreviewChunks } from '../utils';

export class TagsTreeDataProvider implements vscode.TreeDataProvider<ReferenceItem | TagItem> {

	private readonly _listener: vscode.Disposable;
	private readonly _onDidChange = new vscode.EventEmitter<ReferenceItem | undefined>();

	readonly onDidChangeTreeData = this._onDidChange.event;
	private tags: TagItem[] = [];

	constructor() {
	}

	dispose(): void {
		this._onDidChange.dispose();
		this._listener.dispose();
	}

	public setTags(tags: TagItem[]) {
		this.tags = tags;
		this._onDidChange.fire(undefined);
	}

	public getTags() {
		return this.tags;
	}

	public addTag(tag: TagItem) {
		this.tags.push(tag);
		this._onDidChange.fire(undefined);
	}

	public renameTag(tag: TagItem, name: string) {
		const newTag = new TagItem(name, tag.baseLocation, tag.references, tag.decoration);
		this.tags = this.tags.map((t) => t === tag ? newTag : t);
		this._onDidChange.fire(undefined);
	}

	public removeTag(tag: TagItem) {
		this.tags = this.tags.filter((t) => t !== tag);
		this._onDidChange.fire(undefined);
	}

	public changeTagDecoration(tag: TagItem, decoration: vscode.TextEditorDecorationType) {
		tag.decoration.dispose();

		const idx = this.tags.indexOf(tag);
		this.tags[idx] = new TagItem(tag.name, tag.baseLocation, tag.references, decoration);

		this._onDidChange.fire(undefined);
		return this.tags[idx];
	}

	async getTreeItem(element: TagItem | ReferenceItem) {
		if (element instanceof TagItem) {
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
					element.baseLocation.uri,
					<vscode.TextDocumentShowOptions>{ selection: element.baseLocation.range.with({ end: element.baseLocation.range.start }) }
				]
			};
			return result;
		} else {
			// references
			const { range } = element.location;
			const doc = await element.getDocument();
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

	async getChildren(element?: ReferenceItem | TagItem) {
		if (element === undefined) {
			return this.tags;
		}
		if (element instanceof TagItem) {
			return element.references.map((o) => new ReferenceItem(o, element));
		}
		return undefined;
	}

	getParent(element: ReferenceItem | TagItem) {
		return element instanceof ReferenceItem ? element.tag : undefined;
	}
}


