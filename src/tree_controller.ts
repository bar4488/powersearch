import * as vscode from 'vscode';
import { FoldersTreeDataProvider } from './tree/tree';
import { createDecorationFromColor, isValidColor, setFolderDecoration } from './utils';
import { FolderItem, ReferenceData, createReferenceItem, createFolderItem } from './tree/tree_item';

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
    constructor(private tree: FoldersTreeDataProvider) { }

    public async onColorSymbol() {
        let doc = vscode.window.activeTextEditor?.document;

        const basePosition = vscode.window.activeTextEditor?.selection.anchor;
        const refs: vscode.Location[] = await vscode.commands.executeCommand('vscode.executeReferenceProvider', doc.uri, basePosition);
        if (refs.length > 0) {
            const baseRange = doc.getWordRangeAtPosition(basePosition);
            const content = doc.getText(baseRange);
            const folder: FolderItem = createFolderItem({
                name: content,
                location: new vscode.Location(doc.uri, baseRange),
                references: refs.map((t) => createReferenceItem({ location: t })),
                color: "#ffff00",
                decoration: createDecorationFromColor("#ffff00"),
            });
            folder.references.forEach((t) => t.parent = folder);
            this.tree.addNode(folder);
        }
    }

    public async onColorSelection() {
        let doc = vscode.window.activeTextEditor?.document;

        const basePosition = vscode.window.activeTextEditor?.selection.anchor;
        const selection = vscode.window.activeTextEditor?.selection;
        const filename = vscode.workspace.asRelativePath(doc.fileName);
        this.tree.addNodeToSelectedFolder(createReferenceItem({ location: new vscode.Location(doc.uri, selection) }));
    }

    public async onColorLine() {
        let doc = vscode.window.activeTextEditor?.document;

        const basePosition = vscode.window.activeTextEditor?.selection.anchor;
        const lineRange = new vscode.Range(basePosition.with(undefined, 0), basePosition.translate(0, 1000));
        const filename = vscode.workspace.asRelativePath(doc.fileName);
        this.tree.addNodeToSelectedFolder(createReferenceItem({ location: new vscode.Location(doc.uri, lineRange) }));
    }

    public async onChangeFolderColor(folder: FolderItem) {
        let choice = await vscode.window.showQuickPick([...defaultColors.map((o) => o.name), 'Custom', 'None']);
        if (!choice) {
            return;
        }
        if (choice === 'None') {
            this.tree.setFolderColor(folder, undefined);
            return;
        }

        const idx = defaultColors.map((o) => o.name).indexOf(choice);
        let color: string;
        if (idx === -1) {
            color = await vscode.window.showInputBox({ prompt: "Write a color in #xxxxxx format" });
            if (!isValidColor(color)) {
                vscode.window.showInformationMessage("Invalid color format!");
                return;
            }
        }
        else {
            color = defaultColors[idx].value;
        }

        this.tree.setFolderColor(folder, color);
    }

    public async onRenameFolder(folder: FolderItem) {
        let newName = await vscode.window.showInputBox({ prompt: "Enter folder name" });
        if (!newName) {
            return;
        }

        folder.name = newName;
        this.tree.updateNode(folder);
    }

    public async onSelectFolder(folder: FolderItem) {
        this.tree.selectFolder(folder);
    }

    public onRemoveFolder(folder: FolderItem) {
        if (folder.decoration !== undefined) {
            folder.decoration.dispose();
        }
        this.tree.removeNode(folder);
    }

    public async onAddFolder(folder: FolderItem) {
        let newName = await vscode.window.showInputBox({ prompt: "Enter folder name" });
        if (!newName) {
            return;
        }
        else {
            this.tree.addNode(createFolderItem({ name: newName, references: [] }), folder);
        }
    }
}