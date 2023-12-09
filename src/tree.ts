import * as vscode from 'vscode';

export class TagsTreeDataProvider implements vscode.TreeDataProvider<ReferenceItem | TagItem> {

	private readonly _listener: vscode.Disposable;
	private readonly _onDidChange = new vscode.EventEmitter<ReferenceItem | undefined>();

	readonly onDidChangeTreeData = this._onDidChange.event;

	constructor(private tags: TagItem[]) {
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

	public changeTagDecoration(tag: TagItem, decoration: vscode.TextEditorDecorationType) {
		tag.decoration.dispose();

		const idx = this.tags.indexOf(tag);
		this.tags[idx] = new TagItem(tag.name, tag.occurrences, decoration);

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
			return element.occurrences.map((o) => new ReferenceItem(o, element));
		}
		return undefined;
	}

	getParent(element: ReferenceItem | TagItem) {
		return element instanceof ReferenceItem ? element.tag : undefined;
	}
}


export class TagItem {
	constructor(
		readonly name: string,
		readonly occurrences: vscode.Location[],
		readonly decoration: vscode.TextEditorDecorationType,
	) {}


}

export function getPreviewChunks(doc: vscode.TextDocument, range: vscode.Range, beforeLen: number = 8, trim: boolean = true) {
	const previewStart = range.start.with({ character: Math.max(0, range.start.character - beforeLen) });
	const wordRange = doc.getWordRangeAtPosition(previewStart);
	let before = doc.getText(new vscode.Range(wordRange ? wordRange.start : previewStart, range.start));
	const inside = doc.getText(range);
	const previewEnd = range.end.translate(0, 331);
	let after = doc.getText(new vscode.Range(range.end, previewEnd));
	if (trim) {
		before = before.replace(/^\s*/g, '');
		after = after.replace(/\s*$/g, '');
	}
	return { before, inside, after };
}

export class ReferenceItem {

	private _document: Thenable<vscode.TextDocument> | undefined;

	constructor(
		readonly location: vscode.Location,
		readonly tag: TagItem,
	) { }

	async getDocument() {
		if (!this._document) {
			this._document = vscode.workspace.openTextDocument(this.location.uri);
		}
		return this._document;
	}

	async asCopyText() {
		const doc = await this.getDocument();
		const chunks = getPreviewChunks(doc, this.location.range, 21, false);
		return `${this.location.range.start.line + 1}, ${this.location.range.start.character + 1}: ${chunks.before + chunks.inside + chunks.after}`;
	}
}

