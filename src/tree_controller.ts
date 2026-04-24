import * as vscode from 'vscode';
import { DecorationManager } from './decorator';
import { PowerSearchStorage } from './storage';
import { FoldersTreeDataProvider } from './tree/tree';
import { FolderItem, TreeNode, createFolderItem } from './tree/tree_item';
import { isValidColor } from './utils';

const defaultColors = [
    { 'name': 'Navy', 'value': '#001f3f' },
    { 'name': 'Blue', 'value': '#0074D9' },
    { 'name': 'Aqua', 'value': '#7FDBFF' },
    { 'name': 'Teal', 'value': '#39CCCC' },
    { 'name': 'Purple', 'value': '#B10DC9' },
    { 'name': 'Fuchsia', 'value': '#F012BE' },
    { 'name': 'Maroon', 'value': '#85144b' },
    { 'name': 'Red', 'value': '#FF4136' },
    { 'name': 'Orange', 'value': '#FF851B' },
    { 'name': 'Yellow', 'value': '#FFDC00' },
    { 'name': 'Olive', 'value': '#3D9970' },
    { 'name': 'Green', 'value': '#2ECC40' },
    { 'name': 'Lime', 'value': '#01FF70' },
    { 'name': 'Black', 'value': '#111111' },
    { 'name': 'Gray', 'value': '#AAAAAA' },
    { 'name': 'Silver', 'value': '#DDDDDD' },
    { 'name': 'White', 'value': '#FFFFFF' }
];

export class TreeController {
    constructor(
        private readonly tree: FoldersTreeDataProvider,
        private readonly storage: PowerSearchStorage,
        private readonly decorations: DecorationManager,
    ) { }

    public async onColorSymbol() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage("Open an editor before coloring a symbol.");
            return;
        }

        const doc = editor.document;
        const basePosition = editor.selection.anchor;
        const baseRange = doc.getWordRangeAtPosition(basePosition);
        if (!baseRange) {
            vscode.window.showWarningMessage("No symbol found at the current cursor position.");
            return;
        }

        const refs = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', doc.uri, basePosition) ?? [];
        if (refs.length === 0) {
            vscode.window.showWarningMessage("No references found for the selected symbol.");
            return;
        }

        const folder = createFolderItem({
            name: doc.getText(baseRange),
            color: "#ffff00",
            expanded: true,
            children: [],
            references: [],
        });
        this.tree.addNode(folder);
        await this.addLocationsToFolder(refs, folder);
    }

    public async onColorSelection() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage("Open an editor before coloring a selection.");
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showWarningMessage("Select text before coloring a selection.");
            return;
        }

        await this.addLocationsToFolder([new vscode.Location(editor.document.uri, selection)], this.tree.getOrCreateSelectedFolder());
    }

    public async onColorLine() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage("Open an editor before coloring a line.");
            return;
        }

        const lineRange = editor.document.lineAt(editor.selection.anchor.line).range;
        await this.addLocationsToFolder([new vscode.Location(editor.document.uri, lineRange)], this.tree.getOrCreateSelectedFolder());
    }

    public async onChangeFolderColor(folder: FolderItem) {
        let choice = await vscode.window.showQuickPick([...defaultColors.map((o) => o.name), 'Custom', 'None']);
        if (!choice) {
            return;
        }
        if (choice === 'None') {
            this.tree.setFolderColor(folder, undefined);
            await this.decorations.updateVisibleEditors();
            return;
        }

        const idx = defaultColors.map((o) => o.name).indexOf(choice);
        let color: string;
        if (idx === -1) {
            color = await vscode.window.showInputBox({ prompt: "Write a color in #xxxxxx format" });
            if (!isValidColor(color)) {
                vscode.window.showWarningMessage("Invalid color format.");
                return;
            }
        }
        else {
            color = defaultColors[idx].value;
        }

        this.tree.setFolderColor(folder, color);
        await this.decorations.updateVisibleEditors();
    }

    public async onRenameFolder(folder: FolderItem) {
        let newName = await vscode.window.showInputBox({ prompt: "Enter folder name", value: folder.name });
        if (!newName) {
            return;
        }

        folder.name = newName;
        this.tree.updateNode(folder);
    }

    public async onSelectNode(node: TreeNode) {
        await this.tree.selectNode(node);
    }

    public async onRemoveFolder(folder: FolderItem) {
        const removedFolderIds = this.tree.removeNode(folder);
        await this.storage.removeRangesForFolders(removedFolderIds);
        await this.decorations.updateVisibleEditors();
    }

    public async onAddFolder(folder?: FolderItem) {
        let newName = await vscode.window.showInputBox({ prompt: "Enter folder name" });
        if (!newName) {
            return;
        }
        this.tree.addNode(createFolderItem({ name: newName, children: [], references: [] }), folder);
    }

    public async onToggleFolderVisibility(folder: FolderItem) {
        this.tree.toggleVisibility(folder);
        await this.decorations.updateVisibleEditors();
    }

    private async addLocationsToFolder(locations: vscode.Location[], folder: FolderItem): Promise<void> {
        const result = await this.storage.addRanges(locations, folder.id);
        if (result.added > 0) {
            this.tree.addReferences(folder, result.addedReferences);
            await this.decorations.updateVisibleEditors();
        }
        if (result.skippedOutsideWorkspace > 0) {
            vscode.window.showWarningMessage(`Skipped ${result.skippedOutsideWorkspace} reference(s) outside the current workspace.`);
        }
    }
}
