import * as vscode from 'vscode';
import { TagsTreeDataProvider } from './tree/tree';
import { TagData, TagItem, TreeData, TreeNode } from './tree/tag-item';
import { TreeController } from './tree_controller';
import { updateDecorations } from './decorator';
import { dumpTree, parseTree } from './tree/tree_parser';




export function activate(context: vscode.ExtensionContext) {

	let loadedData: TagData[] = context.workspaceState.get('treeData', []);
	let treeItems = loadedData.map((t) => parseTree(t));

	let tree = new TagsTreeDataProvider(treeItems);
	let controller = new TreeController(tree);

	const uri = vscode.window.activeTextEditor.document.uri;
	console.log(uri);
	console.log(uri.toString());
	console.log(vscode.Uri.parse(uri.toString()));

	context.subscriptions.push(
		// vscode.window.registerTreeDataProvider('cyber-explorer.tags', tree),
		vscode.window.createTreeView('cyber-explorer.tags', { treeDataProvider: tree, showCollapseAll: true, canSelectMany: true, dragAndDropController: tree }),


		vscode.window.onDidChangeActiveTextEditor(() => updateDecorations(tree.getNodes())),
		vscode.commands.registerCommand('powersearch.colorSymbol', () => controller.onColorSymbol()),
		vscode.commands.registerCommand("powersearch.chooseTagColor", async (tag, _) => controller.onChangeTagColor(tag)),
		vscode.commands.registerCommand("powersearch.renameTag", async (tag, _) => controller.onRenameTag(tag)),
		vscode.commands.registerCommand("powersearch.removeTag", async (tag, _) => controller.onRemoveTag(tag)),
		vscode.commands.registerCommand("powersearch.saveTree", async () => {
			return context.workspaceState.update('treeData', tree.getNodes().map(t => dumpTree(t as TagItem)));
		},),
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
