import * as cp from 'child_process';
import * as dgram from 'dgram';
import * as vscode from 'vscode';
import {
    Disposable,
    workspace
} from 'vscode';
import {
    ExecuteCommandRequest,
    LanguageClient,
    LanguageClientOptions,
    MessageTransports,
    ServerOptions
} from 'vscode-languageclient/node';

import { EvaluateSelectionFeature } from './commands/evaluate';
import * as defaults from './util/defaults';
import { getSclangPath } from './util/sclang';
import {
    UDPMessageReader,
    UDPMessageWriter
} from './util/readerWriter';

const lspAddress = '127.0.0.1';

const startingPort = 58110;
const portIncrement = 10;
const serverPortKey = 'supercollider.serverPortAllocations.1';
const serverPortSession = 'supercollider.serverPortAllocationsSession.1';

class ServerPortRange implements Disposable {
    start: number;
    globalState: vscode.Memento;

    constructor(globalState: vscode.Memento) {
        this.globalState = globalState;
        const currentSessionID = this.globalState.get<string>(serverPortSession, "");
        if (vscode.env.sessionId != currentSessionID) {
            console.log("New session, so clearing port allocations");
            this.globalState.update(serverPortKey, Array<number>());
        }
        this.globalState.update(serverPortSession, vscode.env.sessionId);

        const allocatedPorts = this.globalState.get<Array<number>>(serverPortKey, Array<number>());
        console.log(`Previously allocated ports: ${allocatedPorts}`);
        this.start = this.findFreePort(allocatedPorts);
        this.globalState.update(serverPortKey, allocatedPorts.concat(this.start));
    }

    findFreePort(allocatedPorts: Array<number>) {
        let port = startingPort;

        while (allocatedPorts.includes(port)) {
            port += portIncrement;
        }

        return port;
    }

    portRange() {
        return [this.start, this.start + portIncrement];
    }

    dispose() {
        const allocatedPorts = this.globalState.get<Array<number>>(serverPortKey, []);
        const index = allocatedPorts.indexOf(this.start);
        if (index > -1) { allocatedPorts.splice(index, 1); }
        this.globalState.update(serverPortKey, allocatedPorts);
    }
};

export class SuperColliderContext implements Disposable {
    subscriptions: vscode.Disposable[] = [];
    client!: LanguageClient;
    evaluateSelectionFeature!: EvaluateSelectionFeature;
    sclangProcess: cp.ChildProcess;
    lspTokenPath: string;
    outputChannel: vscode.OutputChannel;
    globalState: vscode.Memento;
    readerSocket: dgram.Socket;
    serverPorts: ServerPortRange | null;
    activated: boolean = false;

    async processOptions(readPort: number, writePort: number) {
        const configuration = workspace.getConfiguration()

        const sclangPath = await getSclangPath()
        let sclangConfYaml = configuration.get<string>('supercollider.sclang.confYaml', defaults.userConfigPath())
        const loadWorkspaceYaml = configuration.get<boolean>('supercollider.sclang.loadWorkspaceConfYaml', false)
        const sclangArgs = configuration.get<Array<string>>('supercollider.sclang.args')
        const sclangEnv = configuration.get<Object>('supercollider.sclang.environment')

        if (loadWorkspaceYaml) {
            let confFiles = []

            const folders = workspace.workspaceFolders || [];
            for (let folder of folders) {
                let found = await workspace.findFiles(new vscode.RelativePattern(folder, "sclang_conf.yaml"));
                confFiles.push(...found);
            }

            if (confFiles.length == 1) {
                sclangConfYaml = confFiles[0].fsPath;
            } else if (confFiles.length > 1) {
                vscode.window.showErrorMessage("Multiple sclang_conf.yaml files found in workspace. Please set supercollider.sclang.confYaml to the desired file.")
            } else {
                // No files, so use the default
            }
        }

        let env = process.env;
        env['SCLANG_LSP_ENABLE'] = '1';
        env['SCLANG_LSP_SERVERPORT'] = readPort.toString();
        env['SCLANG_LSP_CLIENTPORT'] = writePort.toString();
        env['SCLANG_LSP_LOGLEVEL'] = configuration.get<string>('supercollider.languageServerLogLevel')

        let spawnOptions: cp.SpawnOptions = {
            env: Object.assign(env, sclangEnv)
            // cwd?: string;
            // stdio?: any;
            // detached?: boolean;
            // uid?: number;
            // gid?: number;
            // shell?: boolean | string;
        }

        let args = sclangArgs || [];

        return {
            command: sclangPath,
            args: [
                ...args,
                ...['-i', 'vscode',
                    '-l', sclangConfYaml]
            ],
            options: spawnOptions
        };
    }

    disposeProcess() {
        if (this.sclangProcess) {
            this.sclangProcess.kill();
            this.sclangProcess = null;
        }
    }

    async createProcess(readPort: number, writePort: number) {
        if (this.sclangProcess) {
            this.sclangProcess.kill()
        }

        let options = await this.processOptions(readPort, writePort);
        let sclangProcess = cp.spawn(options.command, options.args, options.options);

        if (!sclangProcess || !sclangProcess.pid) {
            return null;
        }

        return sclangProcess;
    }

    async cleanup(processDied = false) {
        this.activated = false;

        this.disposeProcess();
        // this.evaluateSelectionFeature.dispose();
        this.subscriptions.forEach((d) => {
            d.dispose();
        });
        this.subscriptions = [];

        if (this.client?.isRunning()) {
            await this.client.stop(processDied ? 0 : 2000);
        }
    };

    dispose() {
        if (this.serverPorts) {
            this.serverPorts.dispose();
        }

        return this.cleanup()
    }

    initializationOptions(configuration: vscode.WorkspaceConfiguration) {
        let options = {
            useGlobalStartupFile: configuration.get<boolean>('supercollider.sclang.useGlobalStartupFile', true),
            useWorkspaceStartupFile: configuration.get<boolean>('supercollider.sclang.useWorkspaceStartupFile', true),
        };

        if (!!this.serverPorts) {
            options['suggestedServerPortRange'] = this.serverPorts.portRange();
        }

        return options;
    }

    async activate(globalStoragePath: string, outputChannel: vscode.OutputChannel, globalState: vscode.Memento) {
        let that = this;
        // SUBTLE: We should mark ourselves as activated as soon as we begin doing anything - otherwise,
        //         in case of error, it will look like things are working but they will be unresponsive.
        this.activated = true;

        this.cleanup();

        this.globalState = globalState;
        this.outputChannel = outputChannel;
        outputChannel.show();

        if (workspace.getConfiguration().get<boolean>('supercollider.sclang.autoAllocateServerPorts', true)) {
            this.serverPorts = new ServerPortRange(globalState);
        }

        const serverOptions: ServerOptions = function () {
            // @TODO what if terminal launch fails?

            const configuration = workspace.getConfiguration()

            return new Promise<MessageTransports>((res, err) => {
                let readerSocket = new Promise<dgram.Socket>((resolve, reject) => {
                    let socket = dgram.createSocket('udp4');
                    socket.bind(0, lspAddress, () => {
                        resolve(socket);
                    })
                });
                let writerSocket = new Promise<dgram.Socket>((resolve, reject) => {
                    let socket = dgram.createSocket('udp4');
                    socket.bind({
                        address: lspAddress,
                        exclusive: false
                    },
                        () => {
                            resolve(socket);
                        })
                }).then((socket) => {
                    // SUBTLE: SuperCollider cannot open port=0 (e.g. OS assigneded) ports. So, we stand a better chance of
                    //         finding an open port by opening on our end, then immediately closing and pointing SC that one.
                    var port = socket.address().port;
                    return new Promise<number>((resolve, reject) => {
                        socket.close(() => {
                            resolve(port);
                        })
                    })
                });

                Promise.all([readerSocket, writerSocket]).then(async (sockets) => {
                    let socket = sockets[0];
                    that.readerSocket = socket;

                    let readerPort = socket.address().port;
                    let writerPort = sockets[1];
                    let reader = new UDPMessageReader(socket);
                    let writer = new UDPMessageWriter(socket, writerPort, lspAddress);

                    let sclangProcess = that.sclangProcess = await that.createProcess(readerPort, writerPort);

                    if (!sclangProcess) {
                        err("Problem launching sclang executable. Check your settings to ensure `supercollider.sclang.cmd` points to a valid sclang path.")
                    }

                    const streamInfo: MessageTransports = { reader: reader, writer: writer, detached: false };

                    sclangProcess.stdout
                        .on('data', data => {
                            let string = data.toString();
                            outputChannel.append(string);

                            if (string.indexOf('***LSP READY***') != -1) {
                                res(streamInfo);
                            }
                        })
                        .on('end', async (args) => {
                            outputChannel.append("\nsclang exited\n");
                            reader.dispose();
                            writer.dispose();
                        })
                        .on('error', async (err) => {
                            outputChannel.append("\nsclang errored: " + err);
                            reader.dispose();
                            writer.dispose()
                        });

                    sclangProcess.on('exit', async (code, signal) => {
                        sclangProcess = null;
                        reader.dispose();
                        writer.dispose()
                    });
                });
            });
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector: [{ scheme: 'file', language: 'supercollider' }],
            synchronize: {
                fileEvents: workspace.createFileSystemWatcher('**/*.{sc,scd}'),
            },
            outputChannel: outputChannel,
            markdown: {
                supportHtml: true,
                isTrusted: true
            },
            initializationOptions: this.initializationOptions(workspace.getConfiguration())
        };

        let client = new LanguageClient('SuperColliderLanguageServer', 'SuperCollider Language Server', serverOptions, clientOptions, true);
        // client.trace                   = Trace.Verbose;

        const evaluateSelectionFeature = new EvaluateSelectionFeature(client, this);
        var [disposable, provider] = evaluateSelectionFeature.registerLanguageProvider();
        this.subscriptions.push(disposable);

        client.registerFeature(evaluateSelectionFeature);

        this.client = client;
        this.evaluateSelectionFeature = evaluateSelectionFeature;

        await this.client.start();

        outputChannel.appendLine(`Starting SuperCollider Language Server (sessionId = ${vscode.env.sessionId})`);
    }

    executeCommand(command: string) {
        let result = this.client.sendRequest(ExecuteCommandRequest.type, { command });
        result.then(function (result) {
            console.log(result)
        });
    }
}