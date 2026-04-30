import * as vscode from 'vscode';
import { FolderItem, RootItem } from './tree/tree_item';

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
    for (const idx of indices) {
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
    return typeof color === 'string' && /^#[a-fA-F0-9]{6}$/.test(color);
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
    return !current.isHidden;
}

export function resolveFolderColor(folder: FolderItem): string | undefined {
    if (!folder.inheritsColor) {
        return folder.color;
    }

    let current: FolderItem | RootItem | undefined = folder.parent ?? { type: 'root', children: [], isHidden: false };
    while (current.type !== 'root') {
        if (!current.inheritsColor) {
            return current.color;
        }
        current = current.parent;
        if (!current) {
            return undefined;
        }
    }
    return current.color;
}

export function folderBadgeText(folder: FolderItem, isTarget: boolean): string | undefined {
    const badges: string[] = [];
    if (isTarget) {
        badges.push('target');
    }
    if (folder.inheritsColor) {
        badges.push('parent');
    } else if (folder.color) {
        badges.push(folder.color);
    }
    return badges.length > 0 ? badges.join(' · ') : undefined;
}
