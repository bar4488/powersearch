import * as vscode from 'vscode';
import { rangeFromData } from './tree/tree_item';
import { FoldersTreeDataProvider } from './tree/tree';
import { PowerSearchStorage } from './storage';
import { createDecorationFromColor } from './utils';

export class DecorationManager implements vscode.Disposable {
    private readonly decorations = new Map<string, { color: string; type: vscode.TextEditorDecorationType }>();

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

            for (const range of ranges) {
                if (!coloredFolders.has(range.folderId)) {
                    continue;
                }
                const folderRanges = grouped.get(range.folderId) ?? [];
                folderRanges.push(rangeFromData(range.range));
                grouped.set(range.folderId, folderRanges);
            }

            for (const [folderId, decoration] of this.decorations) {
                editor.setDecorations(decoration.type, grouped.get(folderId) ?? []);
            }
        }
    }

    dispose(): void {
        for (const decoration of this.decorations.values()) {
            decoration.type.dispose();
        }
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
