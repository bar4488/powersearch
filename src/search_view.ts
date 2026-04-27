import * as vscode from 'vscode';
import { SearchFormState, SearchRunResult, TreeController } from './tree_controller';

interface SearchViewState {
	form: SearchFormState;
	folders: ReturnType<TreeController['getSearchFolders']>;
	results: SearchRunResult;
	workspaces: string[];
	showDetails: boolean;
}

export class SearchViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	private view: vscode.WebviewView | undefined;
	private form: SearchFormState;
	private results: SearchRunResult = { results: [], resultCount: 0, fileCount: 0 };
	private showDetails = false;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly controller: TreeController) {
		this.form = this.controller.createInitialSearchState();
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	public refresh() {
		void this.postState();
	}

	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
		};
		webviewView.webview.html = this.getHtml(webviewView.webview);
		this.disposables.push(
			webviewView.webview.onDidReceiveMessage((message) => void this.handleMessage(message)),
			webviewView.onDidDispose(() => {
				if (this.view === webviewView) {
					this.view = undefined;
				}
			}),
		);
		await this.postState();
	}

	private async handleMessage(message: any) {
		switch (message?.type) {
			case 'runSearch':
				this.form = normalizeFormState(message.form, this.form);
				this.results = await this.controller.runSearch(this.form);
				this.showDetails = this.showDetails || !!this.form.includes || !!this.form.excludes;
				await this.postState();
				return;
			case 'toggleDetails':
				this.showDetails = !this.showDetails;
				await this.postState();
				return;
			case 'saveResults':
				if (typeof message.folderId !== 'string' || !message.folderId) {
					void vscode.window.showWarningMessage('Choose a folder before saving results.');
					return;
				}
				if (!await this.controller.saveLatestSearchResults(message.folderId)) {
					void vscode.window.showWarningMessage('Run a search with results before saving.');
					return;
				}
				void vscode.window.showInformationMessage('Saved search results to folder.');
				return;
			case 'openResult':
				if (typeof message.resultId !== 'string') {
					return;
				}
				await this.controller.openSearchResult(message.resultId);
				return;
			case 'dismissResult':
				if (typeof message.resultId !== 'string') {
					return;
				}
				this.results = this.controller.dismissSearchResult(message.resultId);
				await this.postState();
				return;
			default:
				return;
		}
	}

	private async postState() {
		if (!this.view) {
			return;
		}
		const state: SearchViewState = {
			form: this.form,
			folders: this.controller.getSearchFolders(),
			results: this.results,
			workspaces: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.name),
			showDetails: this.showDetails,
		};
		await this.view.webview.postMessage({ type: 'state', state });
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const csp = [
			"default-src 'none'",
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`script-src 'nonce-${nonce}'`,
		].join('; ');
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<style>
		:root {
			color-scheme: light dark;
		}
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			padding: 0 10px 12px;
			color: var(--vscode-foreground);
		}
		section {
			margin-top: 12px;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			padding: 10px;
			background: var(--vscode-editorWidget-background);
		}
		h2 {
			font-size: 12px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: .08em;
			margin: 0 0 10px;
			color: var(--vscode-descriptionForeground);
		}
		label { display: block; }
		.caption {
			display: block;
			margin-bottom: 4px;
			color: var(--vscode-descriptionForeground);
		}
		input[type="text"], select {
			width: 100%;
			box-sizing: border-box;
			padding: 6px 8px;
			border-radius: 4px;
			border: 1px solid var(--vscode-input-border, transparent);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
		}
		.row {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 8px;
		}
		.row.single {
			grid-template-columns: 1fr;
		}
		.stack {
			display: grid;
			gap: 8px;
		}
		.inline {
			display: flex;
			gap: 8px;
			align-items: center;
			flex-wrap: wrap;
		}
		.inline.pad-top-4 {
			padding-top: 4px;
		}

		.input-shell {
			display: flex;
			align-items: center;
			border: 1px solid var(--vscode-input-border, transparent);
			border-radius: 4px;
			background: var(--vscode-input-background);
			overflow: hidden;
		}
		.input-shell input {
			border: 0;
			border-radius: 0;
			background: transparent;
			outline: none;
			padding-right: 4px;
		}
		.icon-toggle-group {
			display: inline-flex;
			gap: 1px;
			padding-right: 4px;
		}
		.toggle {
			min-width: 24px;
			height: 26px;
			padding: 0 4px;
			background: transparent;
			color: var(--vscode-input-foreground);
			border: 0;
			border-radius: 3px;
		}
		.toggle.active {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}
		.scope-group {
			display: inline-flex;
			gap: 6px;
			flex-wrap: wrap;
		}
		.scope-button {
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, transparent);
		}
		.scope-button.active {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}
		.details-toggle {
			min-width: 34px;
			height: 28px;
			padding: 0 10px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, transparent);
		}
		.details-toggle.active {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}
		.checkboxes {
			display: grid;
			grid-template-columns: 1fr;
			gap: 6px;
			margin-top: 4px;
			max-height: 140px;
			overflow: auto;
		}
		button {
			border: 1px solid var(--vscode-button-border, transparent);
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border-radius: 4px;
			padding: 6px 10px;
			cursor: pointer;
		}
		button.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		button.link {
			padding: 0;
			border: 0;
			background: transparent;
			color: var(--vscode-textLink-foreground);
		}
		.summary {
			color: var(--vscode-descriptionForeground);
			margin-top: 8px;
		}
		.help {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			margin-top: 4px;
		}
		.list {
			display: grid;
			gap: 8px;
		}
		.item {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			padding: 8px;
			background: var(--vscode-editor-background);
		}
		.item-title {
			font-weight: 600;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.item-meta {
			color: var(--vscode-descriptionForeground);
			margin: 2px 0 6px;
			font-size: 12px;
		}
		.item-actions {
			display: flex;
			gap: 8px;
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
		}
		.item-actions-left {
			display: flex;
			gap: 8px;
			flex-wrap: wrap;
		}
		.empty {
			color: var(--vscode-descriptionForeground);
		}
		.dismiss {
			border: 0;
			background: transparent;
			color: var(--vscode-descriptionForeground);
			padding: 0 4px;
			font-size: 16px;
			line-height: 1;
		}
	</style>
</head>
<body>
	<section>
		<h2>Query</h2>
		<div class="stack">
			<label>
				<span class="caption">Search</span>
				<div class="input-shell">
					<input id="pattern" type="text" placeholder="Search" />
					<div class="icon-toggle-group">
						<button id="matchCase" class="toggle" title="Match Case">Aa</button>
						<button id="wholeWord" class="toggle" title="Match Whole Word">ab</button>
						<button id="regex" class="toggle" title="Use Regular Expression">.*</button>
					</div>
				</div>
			</label>
			<div>
				<span class="caption">Scope</span>
				<div class="scope-group">
					<button class="scope-button" data-scope="currentFile">Current file</button>
					<button class="scope-button" data-scope="allWorkspaces">All workspaces</button>
					<button class="scope-button" data-scope="selectedWorkspaces">Specific workspaces</button>
					<button id="detailsToggle" class="details-toggle" title="Toggle search details">...</button>
				</div>
			</div>
		</div>
		<div id="workspaceBlock" style="display:none;">
			<span class="caption">Workspaces</span>
			<div id="workspaceChoices" class="checkboxes"></div>
		</div>
		<div id="globBlock" class="stack">
			<label>
				<span class="caption">Files to include</span>
				<input id="includes" type="text" placeholder="Leave empty for everything, or use globs like src/**/*.{ts,tsx}" />
				<div class="help">Only matching files are opened and searched.</div>
			</label>
			<label>
				<span class="caption">Files to exclude</span>
				<input id="excludes" type="text" placeholder="Ignore paths like **/dist/** or **/node_modules/**" />
				<div class="help">Applied before content scanning.</div>
			</label>
		</div>
		<div class="inline pad-top-4">
			<button id="runSearch">Run Search</button>
		</div>
		<div id="summary" class="summary"></div>
	</section>

	<section>
		<h2>Results</h2>
		<div class="row single">
			<label>
				<span class="caption">Save results to folder</span>
				<select id="folderTarget"></select>
			</label>
		</div>
		<div class="inline pad-top-4">
			<button id="saveResults" class="secondary">Save Results</button>
		</div>
		<div id="results" class="list" style="margin-top:10px;"></div>
	</section>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		let currentState = undefined;

		const pattern = document.getElementById('pattern');
		const matchCase = document.getElementById('matchCase');
		const wholeWord = document.getElementById('wholeWord');
		const regex = document.getElementById('regex');
		const includes = document.getElementById('includes');
		const excludes = document.getElementById('excludes');
		const workspaceBlock = document.getElementById('workspaceBlock');
		const workspaceChoices = document.getElementById('workspaceChoices');
		const globBlock = document.getElementById('globBlock');
		const detailsToggle = document.getElementById('detailsToggle');
		const folderTarget = document.getElementById('folderTarget');
		const summary = document.getElementById('summary');
		const results = document.getElementById('results');
		const scopeButtons = [...document.querySelectorAll('[data-scope]')];

		function selectedWorkspaces() {
			return [...workspaceChoices.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
		}

		function collectForm() {
			return {
				pattern: pattern.value,
				isRegex: regex.dataset.active === 'true',
				isCaseSensitive: matchCase.dataset.active === 'true',
				isWholeWord: wholeWord.dataset.active === 'true',
				scope: currentState.form.scope,
				workspaceNames: selectedWorkspaces(),
				includes: includes.value,
				excludes: excludes.value,
			};
		}

		function render(state) {
			currentState = state;
			pattern.value = state.form.pattern;
			setToggle(matchCase, state.form.isCaseSensitive);
			setToggle(wholeWord, state.form.isWholeWord);
			setToggle(regex, state.form.isRegex);
			includes.value = state.form.includes;
			excludes.value = state.form.excludes;
			workspaceBlock.style.display = state.form.scope === 'selectedWorkspaces' ? 'block' : 'none';
			globBlock.style.display = state.showDetails && state.form.scope !== 'currentFile' ? 'grid' : 'none';
			detailsToggle.classList.toggle('active', state.showDetails);
			scopeButtons.forEach((button) => {
				button.classList.toggle('active', button.dataset.scope === state.form.scope);
			});
			workspaceChoices.innerHTML = state.workspaces.length === 0
				? '<div class="empty">No workspace folders.</div>'
				: state.workspaces.map((name) => {
					const checked = state.form.workspaceNames.includes(name) ? 'checked' : '';
					return '<label><input type="checkbox" value="' + escapeHtml(name) + '" ' + checked + ' /> ' + escapeHtml(name) + '</label>';
				}).join('');

			folderTarget.innerHTML = state.folders.length === 0
				? '<option value="">Create a folder first</option>'
				: state.folders.map((folder) => {
					const suffix = folder.isTarget ? ' (target)' : '';
					const desc = folder.description ? ' - ' + folder.description : '';
					return '<option value="' + escapeHtml(folder.id) + '">' + escapeHtml(folder.label + suffix + desc) + '</option>';
				}).join('');

			summary.textContent = state.results.resultCount === 0
				? 'No results yet.'
				: 'Found ' + state.results.resultCount + ' matches in ' + state.results.fileCount + ' files.';

			results.innerHTML = state.results.results.length === 0
				? '<div class="empty">Run a search to see matches.</div>'
				: state.results.results.map((result) => {
					return '<div class="item">'
						+ '<div class="item-title">' + escapeHtml(result.path) + '</div>'
						+ '<div class="item-meta">Line ' + result.line + '</div>'
						+ '<div>' + escapeHtml(result.preview) + '</div>'
						+ '<div class="item-actions" style="margin-top:6px;">'
						+ '<div class="item-actions-left">'
						+ '<button class="link" data-action="openResult" data-id="' + escapeHtml(result.id) + '">Open</button>'
						+ '</div>'
						+ '<button class="dismiss" title="Hide this result" data-action="dismissResult" data-id="' + escapeHtml(result.id) + '">×</button>'
						+ '</div></div>';
				}).join('');
		}

		function setToggle(button, active) {
			button.dataset.active = active ? 'true' : 'false';
			button.classList.toggle('active', active);
		}

		function escapeHtml(value) {
			return String(value)
				.replaceAll('&', '&amp;')
				.replaceAll('<', '&lt;')
				.replaceAll('>', '&gt;')
				.replaceAll('"', '&quot;')
				.replaceAll("'", '&#39;');
		}

		window.addEventListener('message', (event) => {
			if (event.data?.type === 'state') {
				render(event.data.state);
			}
		});

		matchCase.addEventListener('click', (event) => {
			event.preventDefault();
			setToggle(matchCase, matchCase.dataset.active !== 'true');
		});

		wholeWord.addEventListener('click', (event) => {
			event.preventDefault();
			setToggle(wholeWord, wholeWord.dataset.active !== 'true');
		});

		regex.addEventListener('click', (event) => {
			event.preventDefault();
			setToggle(regex, regex.dataset.active !== 'true');
		});

		scopeButtons.forEach((button) => {
			button.addEventListener('click', (event) => {
				event.preventDefault();
				if (!currentState) {
					return;
				}
				currentState.form.scope = button.dataset.scope;
				render(currentState);
			});
		});

		detailsToggle.addEventListener('click', (event) => {
			event.preventDefault();
			vscode.postMessage({ type: 'toggleDetails' });
		});

		document.getElementById('runSearch').addEventListener('click', () => {
			vscode.postMessage({ type: 'runSearch', form: collectForm() });
		});

		document.getElementById('saveResults').addEventListener('click', () => {
			vscode.postMessage({ type: 'saveResults', folderId: folderTarget.value });
		});

		document.body.addEventListener('click', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}
			const action = target.dataset.action;
			const id = target.dataset.id;
			if (!action || !id) {
				return;
			}
			if (action === 'openResult') {
				vscode.postMessage({ type: 'openResult', resultId: id });
			}
			else if (action === 'dismissResult') {
				vscode.postMessage({ type: 'dismissResult', resultId: id });
			}
		});
	</script>
</body>
</html>`;
	}
}

function normalizeFormState(form: any, fallback: SearchFormState): SearchFormState {
	const scope = form?.scope === 'currentFile' || form?.scope === 'selectedWorkspaces' ? form.scope : 'allWorkspaces';
	return {
		pattern: typeof form?.pattern === 'string' ? form.pattern : fallback.pattern,
		isRegex: !!form?.isRegex,
		isCaseSensitive: !!form?.isCaseSensitive,
		isWholeWord: !!form?.isWholeWord,
		scope,
		workspaceNames: Array.isArray(form?.workspaceNames) ? form.workspaceNames.filter((name) => typeof name === 'string') : [],
		includes: typeof form?.includes === 'string' ? form.includes : '',
		excludes: typeof form?.excludes === 'string' ? form.excludes : '',
	};
}

function getNonce() {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let index = 0; index < 32; index += 1) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}
