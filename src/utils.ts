import * as vscode from 'vscode';
import { LocationData, PositionData, RootItem, TagItem, TreeNode, TreeNodeOrRoot } from './tree/tag-item';

export function setTagDecoration(tag: TagItem) {
    let references = tag.references.filter((n) => n.type === 'ref');
    for (let editor of vscode.window.visibleTextEditors) {
        let ranges = references.filter((r) => r.location.uri.toString() === editor.document.uri.toString()).map((r) => r.location.range);
        editor.setDecorations(tag.decoration, ranges);
    }
}

export function positionFrom(positionData: PositionData) {
    return new vscode.Position(positionData.line, positionData.character);
}

export function locationFrom(locationData: LocationData | undefined): vscode.Location | undefined {
    if (!locationData) {
        return undefined;
    }
    let range = new vscode.Range(positionFrom(locationData.range.start), positionFrom(locationData.range.end));
    return new vscode.Location(vscode.Uri.parse(locationData.uriString), range);
}

export function findIndices(node: TreeNode): number[] | undefined {
    let indices = [];
    let curr: TreeNode | RootItem = node;
    while (curr.type !== 'root') {
        const idx = curr.parent.references.indexOf(curr);
        if (idx === -1) {
            return undefined;
        }
        indices.push(idx);
        curr = curr.parent;
    }
    return indices.reverse();
}

export function locationDataFrom(location: vscode.Location | undefined): LocationData | undefined {
    if (!location) {
        return undefined;
    }
    return {
        range: {
            start: {
                line: location.range.start.line,
                character: location.range.start.character,
            },
            end: {
                line: location.range.end.line,
                character: location.range.end.character,
            }
        },
        uriString: location.uri.toString()
    };
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