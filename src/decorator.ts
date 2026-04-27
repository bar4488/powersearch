import * as vscode from 'vscode';
import { rangeFromData } from './tree/tree_item';
import { FoldersTreeDataProvider } from './tree/tree';
import { PowerSearchStorage } from './storage';
import { createDecorationFromColor } from './utils';

export class DecorationManager implements vscode.Disposable {
    private readonly decorations = new Map<string, { color: string; type: vscode.TextEditorDecorationType }>();
    private readonly commentDecorationType = vscode.window.createTextEditorDecorationType({});

    constructor(
        private readonly storage: PowerSearchStorage,
        private readonly tree: FoldersTreeDataProvider,
    ) { }

    async updateVisibleEditors(): Promise<void> {
        const coloredFolders = this.tree.getVisibleColoredFolders();
        this.disposeRemovedOrChangedDecorations(coloredFolders);

        for (const editor of vscode.window.visibleTextEditors) {
            let ranges = [];
            try {
                ranges = await this.storage.getRangesForDocument(editor.document.uri);
            }
            catch (error) {
                void vscode.window.showWarningMessage(`PowerSearch could not load ranges for ${vscode.workspace.asRelativePath(editor.document.uri)}: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
            const grouped = new Map<string, vscode.Range[]>();
            const comments: vscode.DecorationOptions[] = [];

            for (const range of ranges) {
                const color = coloredFolders.get(range.folderId);
                if (!color) {
                    continue;
                }
                const folderRanges = grouped.get(range.folderId) ?? [];
                const storedRange = rangeFromData(range.range);
                folderRanges.push(storedRange);
                grouped.set(range.folderId, folderRanges);
                if (range.comment) {
                    const lineEnd = editor.document.lineAt(storedRange.end.line).range.end;
                    comments.push({
                        range: new vscode.Range(lineEnd, lineEnd),
                        renderOptions: {
                            after: {
                                contentText: ` // ${singleLineComment(range.comment)}`,
                                color,
                                margin: '0 0 0 0.5rem',
                                fontStyle: 'italic',
                            },
                        },
                    });
                }
            }

            for (const [folderId, decoration] of this.decorations) {
                editor.setDecorations(decoration.type, grouped.get(folderId) ?? []);
            }
            editor.setDecorations(this.commentDecorationType, comments);
        }
    }

    dispose(): void {
        for (const decoration of this.decorations.values()) {
            decoration.type.dispose();
        }
        this.commentDecorationType.dispose();
        this.decorations.clear();
    }

    private disposeRemovedOrChangedDecorations(coloredFolders: Map<string, string>): void {
        for (const [folderId, decoration] of [...this.decorations]) {
            const color = coloredFolders.get(folderId);
            if (!color || color !== decoration.color) {
                decoration.type.dispose();
                this.decorations.delete(folderId);
            }
        }

        for (const [folderId, color] of coloredFolders) {
            if (!this.decorations.has(folderId)) {
                const decorationType = createDecorationFromColor(color);
                if (decorationType) {
                    this.decorations.set(folderId, { color, type: decorationType });
                }
            }
        }
    }
}

function singleLineComment(comment: string): string {
    return comment.replace(/\s+/g, ' ').trim();
}
