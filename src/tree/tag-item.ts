import * as vscode from 'vscode';
import { createDecorationFromColor, getPreviewChunks } from '../utils';

export type ParentNode = TagItem | RootItem;
export type TreeNodeOrRoot = TreeNode | RootItem;
export type TreeNode = TagItem | ReferenceItem;
export type TreeData = TagData | ReferenceData;

export interface RootItem {
	type: 'root',
	references: TreeNode[]
}

export interface TagData {
	type: 'tag',
	name: string,
	location: LocationData,
	references: (ReferenceData | TagData)[],
	color?: string,
}

export interface ReferenceData {
	type: 'ref',
	location: LocationData,
}

export interface TagItem {
	type: 'tag',
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

export function createTagData(data: Omit<TagData, 'type'>): TagData {
	return {
		type: 'tag',
		...data
	};
}

export function createTagItem(data: Omit<TagItem, 'type'>): TagItem {
	return {
		type: 'tag',
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