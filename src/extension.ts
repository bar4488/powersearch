import * as vscode from 'vscode';
import { TagsTreeDataProvider } from './tree/tree';
import { TagData, TagItem, TreeData, TreeNode } from './tree/tag-item';
import { TreeController } from './tree_controller';
import { updateDecorations } from './decorator';
import { dumpTree, parseTree } from './tree/tree_parser';


function loadTree(context: vscode.ExtensionContext) {
	let loadedData: TagData[] = context.workspaceState.get('treeData', []);
	let treeItems = loadedData.map((t) => parseTree(t));
	return treeItems;
}

function saveTreeItems(context: vscode.ExtensionContext, treeItems: TreeNode[]) {
	return context.workspaceState.update('treeData', treeItems.map((t) => dumpTree(t as TagItem)));
}

function deleteTreeItems(context: vscode.ExtensionContext) {
	return context.workspaceState.update('treeData', undefined);
}


export function activate(context: vscode.ExtensionContext) {

	let treeItems = loadTree(context);

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
		vscode.commands.registerCommand('powersearch.colorLine', () => controller.onColorLine()),
		vscode.commands.registerCommand('powersearch.colorSelection', () => controller.onColorSelection()),
		vscode.commands.registerCommand("powersearch.chooseTagColor", async (tag, _) => controller.onChangeTagColor(tag)),
		vscode.commands.registerCommand("powersearch.renameTag", async (tag, _) => controller.onRenameTag(tag)),
		vscode.commands.registerCommand("powersearch.removeTag", async (tag, _) => controller.onRemoveTag(tag)),
		vscode.commands.registerCommand("powersearch.addTag", async (tag, _) => controller.onAddTag(tag)),
		vscode.commands.registerCommand("powersearch.removeData", async (tag, _) => deleteTreeItems(context)),
		vscode.commands.registerCommand("powersearch.selectTag", (tag, _) => controller.onSelectTag(tag)),
		vscode.commands.registerCommand("powersearch.saveTree", async () => {
			return saveTreeItems(context, tree.getNodes());
		}),
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
