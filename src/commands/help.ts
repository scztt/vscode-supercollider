import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {ViewColumn} from 'vscode';
import * as vscodelc from 'vscode-languageclient/node';

import {SuperColliderContext} from '../context';

const HelpPanelName = 'supercollider.help';

namespace SearchHelp
{

interface SearchHelpParams {
    searchString: string
}
;

interface SearchHelpResult {
    uri: string|undefined,
        rootUri: string|undefined,
}
;

export const type = new vscodelc.RequestType<SearchHelpParams, SearchHelpResult, void>('documentation/search');
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function getHtmlFromFile(path: string)
{
    path = path.replace('file://', '');

    return new Promise<string>((res, rej) => {
                                   fs.readFile(path, (err, data) => {
                                       if (err)
                                       {
                                           rej(err)
                                       }
                                       else
                                       {
                                           res(data.toString())
                                       }
                                   })});
}

async function searchHelpInActiveDocument(client: vscodelc.LanguageClient)
{
    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor)
        return null;

    const searchRange  = activeTextEditor.selection.isEmpty
                           ? activeTextEditor.document.getWordRangeAtPosition(activeTextEditor.selection.start)
                           : activeTextEditor.selection;
    const searchString = activeTextEditor.document.getText(searchRange);

    if (searchString.length > 0)
    {
        const result  = await client.sendRequest(SearchHelp.type, {
            searchString : searchString,
        });

        let helpPath  = result.uri.replace('file://', '');
        let root      = path.dirname(helpPath.replace('file://', ''));

        let html      = await getHtmlFromFile(helpPath);
        let helpPanel = vscode.window.createWebviewPanel(
            HelpPanelName,
            HelpPanelName,
            ViewColumn.Beside,
            {
                enableFindWidget : true,
                retainContextWhenHidden : true,
                localResourceRoots : [
                    vscode.Uri.file(root)
                ],
                enableScripts : true
            });
        helpPanel.webview.html = html;
    }
}

export function activate(context: SuperColliderContext)
{
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'supercollider.searchHelp',
            () => {
                searchHelpInActiveDocument(context.client)}));
}