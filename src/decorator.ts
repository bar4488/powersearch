import * as vscode from 'vscode';
import { TagsTreeDataProvider } from './tree/tree';
import { createDecorationFromColor, isValidColor, setTagDecoration } from './utils';
import { TagItem } from './tree/tag-item';

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

    public onDidChangeActiveTextEditor() {
        for (let tag of this.tree.getTags()) {
            setTagDecoration(tag);
        }
    }

    public async onColorSymbol() {
        let doc = vscode.window.activeTextEditor?.document;

        const basePosition = vscode.window.activeTextEditor?.selection.anchor;
        const refs: vscode.Location[] = await vscode.commands.executeCommand('vscode.executeReferenceProvider', doc.uri, basePosition);
        if (refs.length > 0) {
            const baseRange = doc.getWordRangeAtPosition(basePosition);
            const content = doc.getText(baseRange);
            const tag = new TagItem(content, new vscode.Location(doc.uri, baseRange), refs, createDecorationFromColor("#ffff00"));
            this.tree.addTag(tag);

            setTagDecoration(tag);
        }
    }

    public async onChangeTagColor(tag: TagItem) {
        let choice = await vscode.window.showQuickPick([...defaultColors.map((o) => o.name), 'Custom']);
        if (!choice) {
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
        const newTag = this.tree.changeTagDecoration(tag, createDecorationFromColor(color));
        setTagDecoration(newTag);
    }

    public async onRenameTag(tag: TagItem) {
        let newName = await vscode.window.showInputBox({prompt: "Enter tag name"});
        if (!newName) {
            return;
        }

        this.tree.renameTag(tag, newName);
    }

    public onRemoveTag(tag: TagItem) {
        tag.decoration.dispose();
        this.tree.removeTag(tag);
    }
}