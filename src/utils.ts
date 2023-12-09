import * as vscode from 'vscode';
import { TagItem } from "./tree";

export function setTagDecoration(tag: TagItem) {
    for (let editor of vscode.window.visibleTextEditors) {
        let ranges = tag.occurrences.filter((r) => r.uri.toString() === editor.document.uri.toString()).map((r) => r.range);
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