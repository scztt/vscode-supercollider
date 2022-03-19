import * as cp from 'child_process';
import * as dgram from 'dgram';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {CancellationToken,
        CompletionContext,
        CompletionItem,
        Disposable,
        Position,
        TextDocument,
        workspace} from 'vscode';
import {Trace} from 'vscode-jsonrpc';
import {LanguageClient,
        LanguageClientOptions,
        MessageTransports,
        Middleware,
        ProvideCompletionItemsSignature,
        ResolveCompletionItemSignature,
        ServerOptions} from 'vscode-languageclient/node';

import {ExecuteSelectionFeature} from './commands/execute.js';
import {UDPMessageReader,
        UDPMessageWriter} from './util/readerWriter.js';

const lspAddress    = '127.0.0.1';
const execDelimiter = '\n' + String.fromCharCode(0x1b);

export class SuperColliderContext implements Disposable
{
    subscriptions: vscode.Disposable[] = [];
    client!: LanguageClient;
    sclangProcess: cp.ChildProcess;
    lspTokenPath: string;
    outputChannel: vscode.OutputChannel;

    processOptions()
    {
        const configuration               = workspace.getConfiguration()

        const sclangPath                  = configuration.get<string>('supercollider.sclang.cmd')
        const sclangArgs                  = configuration.get<Array<string>>('supercollider.sclang.args')
        const sclangEnv                   = configuration.get<Object>('supercollider.sclang.environment')
        const sclangConfYaml              = configuration.get<string>('supercollider.sclang.confYaml')

        const readPort                    = configuration.get<number>('supercollider.sclang.lspReadPort')
        const writePort                   = configuration.get<number>('supercollider.sclang.lspWritePort')

        let env                           = process.env;
        env['SCLANG_LSP_ENABLE']          = '1';
        env['SCLANG_LSP_SERVERPORT']      = readPort.toString();
        env['SCLANG_LSP_CLIENTPORT']      = writePort.toString();

        let spawnOptions: cp.SpawnOptions = {
            env : Object.assign(env, sclangEnv)
            // cwd?: string;
            // stdio?: any;
            // detached?: boolean;
            // uid?: number;
            // gid?: number;
            // shell?: boolean | string;
        }

        return {
            command : sclangPath,
            args : [...sclangArgs,
                    ...['-i', 'vscode',
                        '-l', sclangConfYaml] ],
            options : spawnOptions
        };
    }

    disposeProcess()
    {
        if (this.sclangProcess)
        {
            this.sclangProcess.kill();
            this.sclangProcess = null;
        }
    }

    createProcess()
    {
        if (this.sclangProcess)
        {
            return this.sclangProcess;
        }

        let options       = this.processOptions();
        let sclangProcess = cp.spawn(options.command, options.args, options.options);

        if (!sclangProcess || !sclangProcess.pid)
        {
            return null;
        }

        return sclangProcess;
    }

    execute(string: String)
    {
        if (!this.sclangProcess)
        {
            this.sclangProcess = this.createProcess();
        }

        string = string + execDelimiter;

        this.sclangProcess.stdin.write(string);
    }

    dispose()
    {
        this.disposeProcess();
        this.subscriptions.forEach((d) => { d.dispose(); });
        this.subscriptions = [];
    }

    async activate(globalStoragePath: string, outputChannel: vscode.OutputChannel, workspaceState: vscode.Memento)
    {
        this.outputChannel = outputChannel;
        outputChannel.show();

        let sclangProcess = this.sclangProcess = this.createProcess();

        const serverOptions: ServerOptions     = function() {
            // @TODO what if terminal launch fails?

            const configuration  = workspace.getConfiguration()
            const readPort       = configuration.get<number>('supercollider.sclang.lspReadPort')
            const writePort      = configuration.get<number>('supercollider.sclang.lspWritePort')

            return new Promise<MessageTransports>((res, err) => {
                let readerSocket = dgram.createSocket('udp4');

                readerSocket.bind(readPort, lspAddress, () => {
                    let reader                          = new UDPMessageReader(readerSocket);
                    let writer                          = new UDPMessageWriter(readerSocket, writePort, lspAddress)

                    const streamInfo: MessageTransports = {reader : reader, writer : writer, detached : false};

                    sclangProcess.stdout.on('data', data => {
                        let string = data.toString();
                        if (string.indexOf('***LSP READY***') != -1)
                        {
                            res(streamInfo);
                        }
                        outputChannel.append(string);
                        });

                    sclangProcess.on('exit', (code, signal) => { sclangProcess = null; });
                    });
            });
        };

        // @TODO Cache completions in vscode so we don't need to resolve in sclang?
        let completionMiddleware: Middleware = {
            provideCompletionItem : async function(this: void, document: TextDocument, position: Position, context: CompletionContext, token: CancellationToken, next: ProvideCompletionItemsSignature) {
                return await next(document, position, context, token);
            },
            resolveCompletionItem : async function(this: void, item: CompletionItem, token: CancellationToken, next: ResolveCompletionItemSignature) {
                return await next(item, token);
            }
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector : [ {scheme : 'file', language : 'supercollider'} ],
            synchronize : {
                fileEvents : workspace.createFileSystemWatcher('**/*.*'),
            },
            outputChannel : outputChannel,
        };

        let client   = new LanguageClient('SuperColliderLanguageServer', 'SuperCollider Language Server', serverOptions, clientOptions, true);
        client.trace = Trace.Verbose;

        client.registerFeature(new ExecuteSelectionFeature(client, this));

        client.onReady().then(function(x) {
            client.onNotification('sclang/evalBegin', function(f) {
                vscode.window.setStatusBarMessage('Eval...');
            });

            client.onNotification('sclang/evalEnd', function(f) {
                vscode.window.setStatusBarMessage('Done');
            });
        });

        this.client = client;

        this.subscriptions.push(this.client.start());
    }
}