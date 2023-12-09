import * as vscode from 'vscode';
import { TagItem } from './tree/tag-item';

export function setTagDecoration(tag: TagItem) {
    for (let editor of vscode.window.visibleTextEditors) {
        let ranges = tag.references.filter((r) => r.uri.toString() === editor.document.uri.toString()).map((r) => r.range);
        editor.setDecorations(tag.decoration, ranges);
    }
}

export function createDecorationFromColor(color: string): vscode.TextEditorDecorationType {
    let type: vscode.DecorationRenderOptions = {
        "overviewRulerColor": color,
        "backgroundColor": color,
        "color": "#1f1f1f",
        "fontWeight": "bold"
    };
    return vscode.window.createTextEditorDecorationType(type);
}

export function isValidColor(color: string): boolean {
    return /(?:#|0x)(?:[a-f0-9]{6})\b/.test(color);
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