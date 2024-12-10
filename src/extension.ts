import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CancellationToken, DataTransfer, DocumentDropEdit, Position, TextDocument, workspace } from 'vscode';

import * as help from './commands/help'
import { SuperColliderContext } from './context';
import * as defaults from './util/defaults'
import { getSclangPath } from './util/sclang';
import { ServerStatusBar } from './ServerStatusBar';
import { SuperColliderFormatter } from './providers/FormattingProvider';

export async function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('supercollider', 'supercollider-log');
    context.subscriptions.push(outputChannel);

    let supercolliderContext: SuperColliderContext = null;

    const serverStatusBar = new ServerStatusBar();

    vscode.languages.registerDocumentDropEditProvider({ language: 'supercollider' }, {
        provideDocumentDropEdits: (document: TextDocument, position: Position, dataTransfer: DataTransfer, token: CancellationToken) => {
            let files = [];
            dataTransfer.forEach((item) => {
                var file = item.asFile();
                if (file) {
                    files.push('"' + item.asFile().uri.path + '"');
                }
            });

            if (files.length == 1) {
                return new DocumentDropEdit(files[0]);
            } else {
                return new DocumentDropEdit('[' + files.join(', ') + ']');
            }
        }
    });

    const configuration = workspace.getConfiguration();
    const formatterPath = configuration.get<string>('supercollider.sclang.formatterCmd');
    if (formatterPath && formatterPath.length > 0) {
        const formatter = new SuperColliderFormatter(
            outputChannel,
            formatterPath,
            4, true
        );
        context.subscriptions.push(formatter);
        vscode.languages.registerDocumentFormattingEditProvider({ language: 'supercollider' }, formatter);
    }

    const doActivate = async () => {
        try {
            if (supercolliderContext) {
                help.deactivate(supercolliderContext)
                supercolliderContext.dispose();
            }

            supercolliderContext = new SuperColliderContext();
            await supercolliderContext.activate(context.globalStoragePath, outputChannel, context.globalState);
            help.activate(supercolliderContext);
            supercolliderContext.client.onNotification('supercollider/serverStatus', (data) => {
                serverStatusBar.updateStatusBar(data);
            });
        }
        catch (error) {
            outputChannel.append(error)
        }
    };

    // An empty place holder for the activate command, otherwise we'll get an
    // "command is not registered" error.

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.updateLanguageServer',
        async () => {
            const configuration = workspace.getConfiguration();
            const sclangPath = await getSclangPath();
            const sclangConfYaml = configuration.get<string>('supercollider.sclang.confYaml', defaults.userConfigPath());

            const tempFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-supercollider'))
            const tempFilePath = path.join(tempFolder, 'boostrap.scd');

            await fs.promises.writeFile(
                tempFilePath, `
                try { Quarks.install("https://github.com/scztt/LanguageServer.quark") };
                try { Quarks.update("https://github.com/scztt/LanguageServer.quark") };
                0.exit;`);

            const args = ['-l', sclangConfYaml, tempFilePath];
            let sclangProcess = cp.spawn(sclangPath, args);

            await new Promise((res, rej) => {
                sclangProcess.on('exit', () => {
                    if (sclangProcess.exitCode === 0) {
                        res(true);
                    } else {
                        rej(`Failed to install/update LanguageServer quark. Run command to see error: \n\n${(sclangProcess.spawnargs).join(' ')}`);
                    }
                });
            })
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.restart',
        async () => {
            if (!supercolliderContext || !supercolliderContext.activated) {
                await doActivate();
            }
            else if (supercolliderContext.client?.isRunning()) {
                await supercolliderContext.client.stop();
            }

            if (!supercolliderContext.client?.isRunning()) {
                await supercolliderContext.client.start();
            }
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.bootServer',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.bootServer')
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.rebootServer',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.rebootServer')
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.killAllServers',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.killAllServers')
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.showServerWindow',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.showServerWindow')
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.showServerMeter',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.showServerMeter')
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.showScope',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.showScope')
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.showFreqscope',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.showFreqscope')
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.dumpNodeTree',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.dumpNodeTree')
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.dumpNodeTreeWithControls',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.dumpNodeTreeWithControls')
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.showNodeTree',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.showNodeTree')
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.startRecording',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.startRecording')
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.pauseRecording',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.pauseRecording')
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.stopRecording',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.stopRecording')
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        'supercollider.cmdPeriod',
        async () => {
            supercolliderContext.executeCommand('supercollider.internal.cmdPeriod')
        }));

	context.subscriptions.push(serverStatusBar.getStatusBarItem());
    serverStatusBar.updateStatusBar({running: false, unresponsive: false, avgCPU: 0, peakCPU: 0, numUGens: 0, numSynths: 0, numGroups: 0, numSynthDefs: 0});

    doActivate();

    outputChannel.appendLine('SuperCollider extension activated');
}

function deactivate() { }

exports.activate = activate;
exports.deactivate = deactivate;
