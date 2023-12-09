import * as vscode from 'vscode';

function setRefsDecoration(decoration: vscode.TextEditorDecorationType, refs: vscode.Location[]) {
	for (let editor of vscode.window.visibleTextEditors) {
		let ranges = refs.filter((r) => r.uri.toString() === editor.document.uri.toString()).map((r) => r.range);
		editor.setDecorations(decoration, ranges);
	}
}

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "powersearch" is now active!');
	let ranges = [];
	let type = {
		"overviewRulerColor": "#ffcc00",
		"backgroundColor": "#ffcc00",
		"color": "#1f1f1f",
		"fontWeight": "bold"
	};
	let decoration: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType(type);
	let refs: vscode.Location[] = undefined;

	context.subscriptions.push(
		// vscode.workspace.onDidChangeConfiguration(() => { Decorator.init(); Decorator.decorate(undefined, true); }),
		// vscode.workspace.onDidChangeTextDocument(Changes.onChanges), //
		vscode.window.onDidChangeActiveTextEditor(() => setRefsDecoration(decoration, refs)) // make sure we color variables again on new editors
	);

	let disposable = vscode.commands.registerCommand('powersearch.colorSymbol', async () => {
		let uri = vscode.window.activeTextEditor?.document.uri;

		refs = await vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, vscode.window.activeTextEditor?.selection.anchor);
		setRefsDecoration(decoration, refs);
	});

	let disposable2 = vscode.commands.registerCommand('powersearch.recolor', async () => {
		setRefsDecoration(decoration, refs);
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }
