import * as vscode from 'vscode';
import { TagsTreeDataProvider, TagItem } from './tree';
import { createDecorationFromColor, isValidColor, setTagDecoration } from './utils';

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

export function activate(context: vscode.ExtensionContext) {

	let tree = new TagsTreeDataProvider([]);
	vscode.window.registerTreeDataProvider('cyber-explorer.tags', tree);

	context.subscriptions.push(
		// vscode.workspace.onDidChangeConfiguration(() => { Decorator.init(); Decorator.decorate(undefined, true); }),
		// vscode.workspace.onDidChangeTextDocument(Changes.onChanges), //

		vscode.window.onDidChangeActiveTextEditor(() => {
			for (let tag of tree.getTags()) {
				setTagDecoration(tag);
			}
		}),
		vscode.commands.registerCommand('powersearch.colorSymbol', async () => {
			let doc = vscode.window.activeTextEditor?.document;

			const refs: vscode.Location[] = await vscode.commands.executeCommand('vscode.executeReferenceProvider', doc.uri, vscode.window.activeTextEditor?.selection.anchor);
			if (refs.length > 0) {
				const range = doc.getWordRangeAtPosition(vscode.window.activeTextEditor.selection.anchor);
				const content = doc.getText(range);
				const tag = new TagItem(content, refs, createDecorationFromColor("#ffff00"));
				tree.addTag(tag);

				setTagDecoration(tag);
			}
		}),
		vscode.commands.registerCommand('powersearch.recolor', async () => {
			for (let tag of tree.getTags()) {
				setTagDecoration(tag);
			}
		}),
		vscode.commands.registerCommand("powersearch.cyberexplorer.chooseColor", async (tag, something) => {
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
			const newTag = tree.changeTagDecoration(tag, createDecorationFromColor(color));
			setTagDecoration(newTag);
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
