import * as vscode from 'vscode';
import { TagsTreeDataProvider } from './tree/tree';
import { createDecorationFromColor, isValidColor, setTagDecoration } from './utils';
import { TagItem, ReferenceData, createReferenceItem, createTagItem } from './tree/tag-item';

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
    constructor(private tree: TagsTreeDataProvider) { }

    public async onColorSymbol() {
        let doc = vscode.window.activeTextEditor?.document;

        const basePosition = vscode.window.activeTextEditor?.selection.anchor;
        const refs: vscode.Location[] = await vscode.commands.executeCommand('vscode.executeReferenceProvider', doc.uri, basePosition);
        if (refs.length > 0) {
            const baseRange = doc.getWordRangeAtPosition(basePosition);
            const content = doc.getText(baseRange);
            const tag: TagItem = createTagItem({
                name: content,
                location: new vscode.Location(doc.uri, baseRange),
                references: refs.map((t) => createReferenceItem({ location: t })),
                color: "#ffff00",
                decoration: createDecorationFromColor("#ffff00"),
            });
            tag.references.forEach((t) => t.parent = tag);
            this.tree.addNode(tag);
        }
    }

    public async onColorSelection() {
        let doc = vscode.window.activeTextEditor?.document;

        const basePosition = vscode.window.activeTextEditor?.selection.anchor;
        const selection = vscode.window.activeTextEditor?.selection;
        const filename = vscode.workspace.asRelativePath(doc.fileName);
        this.tree.addNodeToSelectedTag(createReferenceItem({ location: new vscode.Location(doc.uri, selection) }));
    }

    public async onColorLine() {
        let doc = vscode.window.activeTextEditor?.document;

        const basePosition = vscode.window.activeTextEditor?.selection.anchor;
        const lineRange = new vscode.Range(basePosition.with(undefined, 0), basePosition.translate(0, 1000));
        const filename = vscode.workspace.asRelativePath(doc.fileName);
        this.tree.addNodeToSelectedTag(createReferenceItem({ location: new vscode.Location(doc.uri, lineRange) }));
    }

    public async onChangeTagColor(tag: TagItem) {
        let choice = await vscode.window.showQuickPick([...defaultColors.map((o) => o.name), 'Custom', 'None']);
        if (!choice) {
            return;
        }
        if (choice === 'None') {
            this.tree.setTagColor(tag, undefined);
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

        this.tree.setTagColor(tag, color);
    }

    public async onRenameTag(tag: TagItem) {
        let newName = await vscode.window.showInputBox({ prompt: "Enter tag name" });
        if (!newName) {
            return;
        }

        tag.name = newName;
        this.tree.updateNode(tag);
    }

    public async onSelectTag(tag: TagItem) {
        this.tree.selectTag(tag);
    }

    public onRemoveTag(tag: TagItem) {
        if (tag.decoration !== undefined) {
            tag.decoration.dispose();
        }
        this.tree.removeNode(tag);
    }

    public async onAddTag(tag: TagItem) {
        let newName = await vscode.window.showInputBox({ prompt: "Enter tag name" });
        if (!newName) {
            return;
        }
        else {
            this.tree.addNode(createTagItem({ name: newName, references: [] }), tag);
        }
    }
}