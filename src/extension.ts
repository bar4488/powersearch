import * as vscode from 'vscode';
import { TagsTreeDataProvider } from './tree/tree';
import { TreeController } from './decorator';


export function activate(context: vscode.ExtensionContext) {
	let tree = new TagsTreeDataProvider();

	let controller = new TreeController(tree);

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('cyber-explorer.tags', tree),

		vscode.window.onDidChangeActiveTextEditor(() => controller.onDidChangeActiveTextEditor()),
		vscode.commands.registerCommand('powersearch.colorSymbol', () => controller.onColorSymbol()),
		vscode.commands.registerCommand("powersearch.chooseTagColor", async (tag, _) => controller.onChangeTagColor(tag)),
		vscode.commands.registerCommand("powersearch.removeTag", async (tag, _) => controller.onRemoveTag(tag)),
		vscode.commands.registerCommand("powersearch.renameTag", async (tag, _) => controller.onRenameTag(tag)),
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
