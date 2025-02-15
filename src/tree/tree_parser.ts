import { createDecorationFromColor, locationDataFrom, locationFrom } from "../utils";
import { FolderData, FolderItem, createReferenceData, createReferenceItem } from "./tree_item";

export function parseTree(root: FolderData, parent: FolderItem | undefined = undefined): FolderItem {
    let rootItem: FolderItem = {
        type: "folder",
        name: root.name,
        references: [],
        location: locationFrom(root.location),
        color: root.color,
        decoration: createDecorationFromColor(root.color),
        parent: parent
    };

    for (const node of root.references) {
        if (node.type === "ref") {
            rootItem.references.push(createReferenceItem({ location: locationFrom(node.location), parent: rootItem }));
        }
        else {
            rootItem.references.push(parseTree(node, rootItem));
        }
    }
    return rootItem;
}

export function dumpTree(root: FolderItem): FolderData {
    let data: FolderData = {
        type: 'folder',
        name: root.name,
        location: locationDataFrom(root.location),
        references: [],
        color: root.color
    };

    for (const node of root.references) {
        if (node.type === 'ref') {
            data.references.push(createReferenceData({location: locationDataFrom(node.location)}));
        }
        else {
            data.references.push(dumpTree(node));
        }
    }
    return data;
}