import * as vscode from 'vscode';
import { getPreviewChunks } from '../utils';

export class TagItem {
	constructor(
		readonly name: string,
        readonly baseLocation: vscode.Location,
		readonly references: vscode.Location[],
		readonly decoration: vscode.TextEditorDecorationType,
	) {}
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
