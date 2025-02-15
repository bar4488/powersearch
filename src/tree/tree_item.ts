import * as vscode from 'vscode';
import { createDecorationFromColor, getPreviewChunks } from '../utils';

export type ParentNode = FolderItem | RootItem;
export type TreeNodeOrRoot = TreeNode | RootItem;
export type TreeNode = FolderItem | ReferenceItem;
export type TreeData = FolderData | ReferenceData;

export interface RootItem {
	type: 'root',
	references: TreeNode[]
}

export interface FolderData {
	type: 'folder',
	name: string,
	location: LocationData,
	references: (ReferenceData | FolderData)[],
	color?: string,
}

export interface ReferenceData {
	type: 'ref',
	location: LocationData,
}

export interface FolderItem {
	type: 'folder',
	name: string,
	references: TreeNode[],
	location?: vscode.Location,
	color?: string, 

	expanded?: boolean,
	decoration?: vscode.TextEditorDecorationType
	parent?: ParentNode
}

export interface ReferenceItem {
	type: 'ref',
	location: vscode.Location,
	parent?: ParentNode
}

export interface PositionData {
	line: number,
	character: number,
}

export interface LocationData {
	uriString: string,
	range: {
		start: PositionData,
		end: PositionData
	}
}

export function createFolderItem(data: Omit<FolderItem, 'type'>): FolderItem {
	return {
		type: 'folder',
		...data
	};
}

export function createReferenceData(data: Omit<ReferenceData, 'type'>): ReferenceData {
	return {
		type: 'ref',
		...data
	};
}

export function createReferenceItem(data: Omit<ReferenceItem, 'type'>): ReferenceItem {
	return {
		type: 'ref',
		...data
	};
}