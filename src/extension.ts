import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {workspace} from 'vscode';

import * as help from './commands/help'
import {SuperColliderContext} from './context';
import * as defaults from './util/defaults'
import { getSclangPath } from './util/sclang';

export async function activate(context: vscode.ExtensionContext)
{
    const outputChannel = vscode.window.createOutputChannel('supercollider', 'supercollider-log');
    context.subscriptions.push(outputChannel);

    const supercolliderContext = new SuperColliderContext;
    context.subscriptions.push(supercolliderContext);

    const doActivate = async () => {
        try
        {
            await supercolliderContext.activate(context.globalStoragePath, outputChannel, context.workspaceState);
            help.activate(supercolliderContext);
        }
        catch (error)
        {
            outputChannel.append(error)
        }
    };

    // An empty place holder for the activate command, otherwise we'll get an
    // "command is not registered" error.
    context.subscriptions.push(vscode.commands.registerCommand('supercollider.activate', async () => {}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.updateLanguageServer',
        async () => {
            const configuration  = workspace.getConfiguration();
            const sclangPath     = await getSclangPath();
            const sclangConfYaml = configuration.get<string>('supercollider.sclang.confYaml', defaults.userConfigPath());

            if (sclangConfYaml != '' && !fs.existsSync(sclangConfYaml)) {
                throw new Error("Sclang config file does not exist. Please check the 'supercollider.sclang.confYaml' path in your settings.");
            }

            const tempFilePath = await new Promise<string>((res, err) => {
                                                               fs.mkdtemp(
                                                                   path.join(os.tmpdir(), 'vscode-supercollider'),
                                                                   (errorResult, folder: string) => {
                                                                       if (errorResult)
                                                                       {
                                                                           err(errorResult);
                                                                       }
                                                                       else
                                                                       {
                                                                           let finalPath = path.join(folder, 'boostrap.scd');
                                                                           fs.writeFile(
                                                                               finalPath,
                                                                               `
                                                                               var exitCode = 0;
                                                                               try { Quarks.install("https://github.com/scztt/LanguageServer.quark");
                                                                                     Quarks.update("https://github.com/scztt/LanguageServer.quark");
                                                                               } { |err|
                                                                                     postln(err.errorString);
                                                                                     exitCode = 1;
                                                                               };
                                                                               exitCode.exit;
                                                                               `,
                                                                               null,
                                                                               () => {res(finalPath)});
                                                                       }
                                                                   })});

            const args         = [ '-l', sclangConfYaml, tempFilePath ];
            let sclangProcess  = cp.spawn(sclangPath, args);

            await new Promise((res, rej) => {
                sclangProcess.on('exit', () => {
                    if (sclangProcess.exitCode == 1) {
                        rej(`Failed to install/update LanguageServer quark. Run command to see error: \n\n${(sclangProcess.spawnargs).join(' ')}`);
                    }
                    res(true);
                });
            })
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.restart',
        async () => {
            if (!supercolliderContext.activated)
            {
                await doActivate();
            }
            else if (!!supercolliderContext.client && supercolliderContext.client.isRunning())
            {
                await supercolliderContext.client.stop();
            }

            if (!supercolliderContext.client.isRunning())
            {
                await supercolliderContext.client.start();
            }
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.bootServer',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.bootServer')}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.rebootServer',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.rebootServer')}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.killAllServers',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.killAllServers')}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.showServerWindow',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.showServerWindow')}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.cmdPeriod',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.cmdPeriod')}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.showServerMeter',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.showServerMeter')}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.showScope',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.showScope')}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.showFreqscope',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.showFreqscope')}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.dumpNodeTree',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.dumpNodeTree')}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.dumpNodeTreeWithControls',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.dumpNodeTreeWithControls')}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.showNodeTree',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.showNodeTree')}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.startRecording',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.startRecording')}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.pauseRecording',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.pauseRecording')}));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.stopRecording',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.stopRecording')}));

    doActivate();
}
exports.activate = activate;

function deactivate()
{
}
exports.deactivate = deactivate;