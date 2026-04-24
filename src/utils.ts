import * as vscode from 'vscode';
import { FolderItem, PositionData, RootItem } from './tree/tree_item';

export function positionFrom(positionData: PositionData) {
    return new vscode.Position(positionData.line, positionData.character);
}

export function nodeToIndices(node: FolderItem): number[] | undefined {
    let indices = [];
    let curr: FolderItem | RootItem = node;
    while (curr.type !== 'root') {
        const idx = curr.parent.children.indexOf(curr);
        if (idx === -1) {
            return undefined;
        }
        indices.push(idx);
        curr = curr.parent;
    }
    return indices.reverse();
}

export function indicesToNode(indices: number[], root: RootItem): FolderItem | undefined {
    let curr: FolderItem | undefined;
    let children = root.children;
    for (var idx of indices) {
        curr = children[idx];
        if (!curr) {
            return undefined;
        }
        children = curr.children;
    }
    return curr;
}

export function createDecorationFromColor(color: string | undefined): vscode.TextEditorDecorationType | undefined {
    if (!color) {
        return undefined;
    }
    let type: vscode.DecorationRenderOptions = {
        "overviewRulerColor": color,
        "backgroundColor": color,
        "color": "#1f1f1f",
        "fontWeight": "bold"
    };
    return vscode.window.createTextEditorDecorationType(type);
}

export function isValidColor(color: string | undefined): boolean {
    return typeof color === 'string' && /^(?:#|0x)(?:[a-fA-F0-9]{6})$/.test(color);
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

export function folderAndAncestorsVisible(folder: FolderItem): boolean {
    let current: FolderItem | RootItem = folder;
    while (current.type !== 'root') {
        if (current.isHidden) {
            return false;
        }
        current = current.parent;
    }
    return true;
}
