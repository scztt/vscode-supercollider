import * as cp from 'child_process';
import * as dgram from 'dgram';
import * as vscode from 'vscode';
import {
    Disposable,
    workspace,
    EventEmitter,
    TextDocument,
    CancellationToken,
    ProviderResult,
    CodeLens
} from 'vscode';
import {
    CodeLensMiddleware,
    ExecuteCommandRequest,
    FoldingRangeProviderMiddleware,
    FoldingRangeRequest,
    LanguageClient,
    LanguageClientOptions,
    MessageTransports,
    ProvideCodeLensesSignature,
    ProvideFoldingRangeSignature,
    ServerOptions,
    State,
    TextDocumentIdentifier
} from 'vscode-languageclient/node';

import { EvaluateSelectionFeature } from './commands/evaluate';
import * as defaults from './util/defaults';
import { getSclangPath } from './util/sclang';
import {
    UDPMessageReader,
    UDPMessageWriter
} from './util/readerWriter';
import { LiveshareGuestProxy, LiveshareHost, onLiveshareSession } from './util/liveshare';
import { Role } from 'vsls';

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

// Define the output message interface
export interface OutputMessage {
    text: string;
    source: 'sclang' | 'vscode';
}

// Add a delegate interface for evaluation
export interface EvaluationResult {
    result: string | null;
    error: string | null;
    compileError: string | null;
}

export interface EvaluationDelegate {
    doEvaluate(textDocument: TextDocumentIdentifier, sourceCode: string, user?: string): Promise<EvaluationResult>;
}

export interface CommandDelegate {
    doCommand(command: string, user?: string): void;
}

export class SuperColliderContext implements Disposable, EvaluationDelegate, CommandDelegate {
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
    waitingForBoot: boolean = false;
    liveshareGuestProxy: LiveshareGuestProxy;
    liveshareHost: LiveshareHost;
    commandDelegate: CommandDelegate;

    // Create event emitter for output messages
    private _outputEventEmitter = new EventEmitter<OutputMessage>();
    readonly onOutputMessage = this._outputEventEmitter.event;

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

    async createProcess(readPort: number, writePort: number) {
        let options = await this.processOptions(readPort, writePort);
        let sclangProcess = cp.spawn(options.command, options.args, options.options);

        if (!sclangProcess || !sclangProcess.pid) {
            return null;
        }

        return sclangProcess;
    }

    disposeProcess() {
        if (this.sclangProcess?.connected) {
            this.sclangProcess.kill();
        }
        this.sclangProcess = null;
    }

    async cleanup() {
        this.disposeProcess();
        this.subscriptions.forEach((d) => {
            d.dispose();
        });
        // this.subscriptions = [];
    };

    dispose() {
        // Clean up event emitter
        this._outputEventEmitter.dispose();
        this.stopClient();
        this.deactivate();
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

    async doEvaluate(textDocument: TextDocumentIdentifier, sourceCode: string, user: string | null): Promise<EvaluationResult> {
        return this.client.sendRequest("textDocument/evaluateSelection", {
            textDocument: textDocument,
            sourceCode: sourceCode,
            user: user
        });
    }

    async activate(outputChannel: vscode.OutputChannel, globalState: vscode.Memento) {
        if (this.activated) { return }
        let that = this;

        this.globalState = globalState;
        this.outputChannel = outputChannel;

        // Subscribe the output channel to the output event
        this.subscriptions.push(this.onOutputMessage(message => {
            outputChannel.append(message.text);
        }));

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

                    that.waitingForBoot = true;
                    let sclangProcess = that.sclangProcess = await that.createProcess(readerPort, writerPort);

                    if (!sclangProcess) {
                        err("Problem launching sclang executable. Check your settings to ensure `supercollider.sclang.cmd` points to a valid sclang path.")
                    }

                    const streamInfo: MessageTransports = { reader: reader, writer: writer, detached: false };

                    sclangProcess.stdout
                        .on('data', data => {
                            let string = data.toString();
                            // Emit event instead of direct outputChannel access
                            that._outputEventEmitter.fire({
                                text: string,
                                source: 'sclang'
                            });

                            if (string.indexOf('***LSP READY***') != -1) {
                                that.waitingForBoot = false;
                                res(streamInfo);
                            }
                        })
                        .on('end', async (args) => {
                            // Emit end event
                            that._outputEventEmitter.fire({
                                text: "\nsclang exited\n",
                                source: 'vscode'
                            });

                            reader.dispose();
                            writer.dispose();
                            that.disposeProcess();
                        })
                        .on('error', async (err) => {
                            // Emit error event
                            that._outputEventEmitter.fire({
                                text: "\nsclang errored: " + err,
                                source: 'sclang'
                            });

                            reader.dispose();
                            writer.dispose()
                            that.disposeProcess();
                        });

                    sclangProcess.on('exit', async (code, signal) => {
                        reader.dispose();
                        writer.dispose()
                        that.disposeProcess();
                    });

                    // Emit startup message
                    that._outputEventEmitter.fire({
                        text: "\n\n*********************************************************\n\n\n",
                        source: 'vscode'
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
            initializationOptions: this.initializationOptions(workspace.getConfiguration()),
        };

        this.client = new LanguageClient('SuperColliderLanguageServer', 'SuperCollider Language Server', serverOptions, clientOptions, true);
        this.subscriptions.push(this.client);

        const evaluateSelectionFeature = new EvaluateSelectionFeature(this.client, this, this);
        this.client.registerFeature(evaluateSelectionFeature);
        this.subscriptions.push(evaluateSelectionFeature);

        var [disposable, _] = evaluateSelectionFeature.registerLanguageProvider();
        this.subscriptions.push(disposable);

        let liveshareSessionRole = Role.None;
        let currentLiveShareSession: string | null;
        let currentCoopSession: string | null;
        this.commandDelegate = this;

        const updateLiveshareSession = () => {
            const enabled = workspace.getConfiguration().get<boolean>('supercollider.enableLiveShareCoop', false);
            const hasActiveLiveShareSession = liveshareSessionRole !== Role.None;

            // End coop
            if (!enabled || !hasActiveLiveShareSession || currentCoopSession === null || currentCoopSession !== currentLiveShareSession) {
                currentCoopSession = null;

                this.liveshareHost?.dispose();
                this.liveshareHost = null;
                this.liveshareGuestProxy?.dispose();
                this.liveshareGuestProxy = null;

                evaluateSelectionFeature.evaluationDelegate = this;
                this.commandDelegate = this;
            } else if (liveshareSessionRole === Role.Host) {
                if (!this.liveshareHost) {
                    this.liveshareHost = new LiveshareHost(this.onOutputMessage);
                    this.liveshareHost.connect(this, this);
                    this.liveshareHost.onPeersChanged((e) => {
                        e.added.forEach((peer) => {
                            outputChannel.appendLine(`User joined: ${peer.user.userName} (${peer.user.displayName})`,);
                        });
                        e.removed.forEach((peer) => {
                            outputChannel.appendLine(`User left: ${peer.user.userName} (${peer.user.displayName})`,);
                        });
                    });

                    outputChannel.appendLine(`*** Hosting co-op LiveShare session, id: ${currentLiveShareSession} ***`);
                    outputChannel.appendLine("*** Remote LiveShare users can execute code on your machine! ***");
                }
                evaluateSelectionFeature.evaluationDelegate = this.liveshareHost;
                this.commandDelegate = this;
            } else if (liveshareSessionRole === Role.Guest) {
                if (!this.liveshareGuestProxy) {
                    this.liveshareGuestProxy = new LiveshareGuestProxy();
                    this.liveshareGuestProxy.connect();
                }
                evaluateSelectionFeature.evaluationDelegate = this.liveshareGuestProxy;
                this.commandDelegate = this.liveshareGuestProxy;
            }

            vscode.commands.executeCommand(
                'setContext', 'supercollider.startLiveShareCoopSession.enabled',
                enabled && hasActiveLiveShareSession && currentCoopSession === null
            );
            vscode.commands.executeCommand(
                'setContext', 'supercollider.endLiveShareCoopSession.enabled',
                enabled && hasActiveLiveShareSession && currentCoopSession !== null
            );
        };

        this.subscriptions.push(vscode.commands.registerCommand(
            'supercollider.startLiveShareCoopSession',
            async () => {
                currentCoopSession = currentLiveShareSession;
                updateLiveshareSession();
            }));

        this.subscriptions.push(vscode.commands.registerCommand(
            'supercollider.endLiveShareCoopSession',
            async () => {
                currentCoopSession = null;
                updateLiveshareSession();
            }));

        workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('supercollider.enableLiveShareCoop')) {
                updateLiveshareSession()
            }
        });

        this.subscriptions.push(
            await onLiveshareSession((role, id) => {
                const enabled = workspace.getConfiguration().get<boolean>('supercollider.enableLiveShareCoop', false);

                if (enabled && role != Role.None) {
                    const options = ['Yes', 'No'];

                    const description = role === Role.Host
                        ? 'You are hosting a LiveShare session. Do you want to use co-op mode? THIS MEANS REMOTE USERS CAN EXECUTE CODE ON YOUR MACHINE.'
                        : 'You are joining a LiveShare session. Do you want to use co-op mode? This means you will be executing code on the host machine.';

                    vscode.window.showQuickPick(options, {
                        placeHolder: description,
                        canPickMany: false,
                        ignoreFocusOut: false
                    }).then((result) => {
                        if (result == 'Yes') {
                            role = Role.Host;
                            currentCoopSession = id;
                        };
                        liveshareSessionRole = role;
                        currentLiveShareSession = id;
                        updateLiveshareSession();
                    });
                } else {
                    liveshareSessionRole = role;
                    currentLiveShareSession = id;
                }
            })
        );

        this.activated = true;
    }

    async deactivate() {
        if (!this.activated) { return }

        this.activated = false;
        this.globalState = null;
        this.outputChannel = null;

        this.subscriptions.forEach((d) => {
            d.dispose();
        });
        this.subscriptions.slice(0, 0);

        this.client.dispose();
        this.client = null;
    }

    async startClient() {
        if (this.client?.isRunning()) { return }

        if (this.client.state == State.Running) {
            await this.client.restart();
        } else {
            await this.client.start();
        }

        // Use the emitter instead of direct outputChannel access
        this._outputEventEmitter.fire({
            text: `Starting SuperCollider Language Server (sessionId = ${vscode.env.sessionId})\n`,
            source: 'vscode'
        });
    }

    async stopClient(processDied = false) {
        if (!this.client?.isRunning()) {
            this.disposeProcess();
            return;
        }

        await this.client.stop(processDied ? 0 : 2000);
    }

    async restart() {
        if (this.client.state == State.Starting) {
            const outputChannel = this.outputChannel;
            const globalState = this.globalState;
            await this.deactivate();
            await this.activate(outputChannel, globalState);
            await this.startClient();

        } else {
            await this.stopClient();
            await this.startClient();
        }
    }

    doCommand(command: string, user?: string) {
        let result = this.client.sendRequest(ExecuteCommandRequest.type, { command });
        result.then(function (result) {
            console.log(result)
        });
    }

    executeCommand(command: string) {
        this.commandDelegate.doCommand(command);
    }
}