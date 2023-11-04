import * as fs from 'fs';
import * as path from 'path'
import * as vscode from 'vscode';
import {workspace} from 'vscode';

import * as defaults from './defaults';

async function findSclangPath(pathHint: string)
{
    pathHint       = path.dirname(pathHint)

    const response = await vscode.window.showOpenDialog({
        title : `SuperCollider ${defaults.sclangExecutable()} executable`,
        defaultUri : vscode.Uri.file(pathHint),
        canSelectFiles : true,
        canSelectFolders : false,
        canSelectMany : false,
    });
    const userPath = response[0].fsPath

    fs.promises.access(userPath, fs.constants.X_OK);
    workspace.getConfiguration().update('supercollider.sclang.cmd', userPath, vscode.ConfigurationTarget.Global);

    return userPath;
}

export async function getSclangPath()
{
    const configuration = workspace.getConfiguration();
    const sclangPath    = configuration.get<string>('supercollider.sclang.cmd', defaults.sclangPath()) || defaults.sclangPath()

    try
    {
        await fs.promises.access(sclangPath);
        return sclangPath;
    }
    catch
    {
        const changeSetting = "Find sclang"
        const choice        = await vscode.window.showErrorMessage(
            `Could not find sclang executable at the path: ${sclangPath}.`,
            changeSetting);

        if (choice == changeSetting)
        {
            return findSclangPath(sclangPath);
        }
        else
        {
            throw ('Could not find sclang path.')
        }
    }
}
