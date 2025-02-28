import { Command, Disposable, Event, EventEmitter, OutputChannel, Uri, window } from "vscode";
import * as vsls from 'vsls';
import { EvaluationDelegate, EvaluationResult, CommandDelegate, OutputMessage } from "../context";
import { internalCommands } from "../extension";

// Import the EvaluateSelectionParams interface
interface EvaluateSelectionParams {
    textDocument: TextDocumentIdentifier;
    sourceCode: string;
    guestUser?: string;
}

// Simple interface for TextDocumentIdentifier
interface TextDocumentIdentifier {
    uri: string;
}

export class LiveshareGuestProxy implements Disposable, EvaluationDelegate, CommandDelegate {
    private _connected: boolean = false;
    private _liveshare: vsls.LiveShare;
    private _service: vsls.SharedServiceProxy = null;
    private _outputChannel: OutputChannel;

    constructor() {
        this._outputChannel = window.createOutputChannel("SuperCollider Coop", 'supercollider-log');
        this._outputChannel.show();
    }

    async connect(): Promise<void> {
        if (this._connected) {
            return;
        }

        this._liveshare = await vsls.getApi();
        if (!this._liveshare) {
            throw new Error("LiveShare API not available");
        }

        // @TODO: Improve error handling
        this._service = await this._liveshare.getSharedService('supercollider');
        this._service.onNotify('textDocument/output', (message: OutputMessage) => {
            this._outputChannel.append(message.text);
        });

        this._outputChannel.appendLine(`Connected to LiveShare session, id: {this._liveshare.session.id}`);

        this._connected = true;
    }

    async disconnect(): Promise<void> {
        this._service = null;
        this._connected = false;
    }

    doEvaluate(textDocument: TextDocumentIdentifier, sourceCode: string, user?: string): Promise<EvaluationResult> {
        return this._service.request(
            'textDocument/evaluateSelection',
            [
                textDocument.uri,
                sourceCode,
                user || this._liveshare.session.user?.displayName || 'unknown',
            ]);
    }

    doCommand(command: string, user: string | null): Promise<any> {
        return this._service.request(command, [user]);
    }

    dispose() {
        this._outputChannel.dispose();
        this.disconnect();
    }
}

export class LiveshareHost implements Disposable, EvaluationDelegate, CommandDelegate {
    private _connected: boolean = false;
    private _liveshare: vsls.LiveShare;
    private _service: vsls.SharedService = null;
    private _evaluationDelegate: EvaluationDelegate | null = null;
    private _commandDelegate: CommandDelegate | null = null;
    private _subscriptions: Disposable[] = [];

    constructor(outputEvent: Event<OutputMessage>) {
        this._subscriptions.push(outputEvent((message: OutputMessage) => {
            this._service.notify('textDocument/output', message);
        }));
    }

    doEvaluate(textDocument: TextDocumentIdentifier, sourceCode: string, user?: string): Promise<EvaluationResult> {
        if (!this._evaluationDelegate) {
            return Promise.reject(new Error("No evaluation handler registered"));
        }

        user = user || this._liveshare.session?.user?.displayName || 'unknown';

        return this._evaluationDelegate.doEvaluate(textDocument, sourceCode, user);
    }

    doCommand(command: string, user?: string): void {
        if (!this._commandDelegate) {
            throw new Error("No evaluation handler registered");
        }

        return this._commandDelegate.doCommand(command, user);
    }

    async connect(evaluationDelegate: EvaluationDelegate, commandDelegate: CommandDelegate): Promise<void> {
        if (this._connected) {
            await this.disconnect();
        }

        this._evaluationDelegate = evaluationDelegate;
        this._commandDelegate = commandDelegate;

        this._liveshare = await vsls.getApi();
        if (!this._liveshare) {
            throw new Error("LiveShare API not available");
        }

        this._service = await this._liveshare.shareService('supercollider');

        // Set up request handler for guest evaluation
        if (this._service) {
            for (const command of internalCommands) {
                this._service.onRequest(command, async ([context, user]) => {
                    return this._commandDelegate.doCommand(command, user);
                });
            }

            this._service.onRequest(
                'textDocument/evaluateSelection',
                async ([context, docUri, sourceCode, guestUser]) => {
                    if (!this._evaluationDelegate) {
                        return { error: "No evaluation handler registered" };
                    }

                    docUri = docUri.replace("file:/", "vsls:/")
                    docUri = this._liveshare.convertSharedUriToLocal(Uri.parse(docUri));

                    try {
                        const textDocument: TextDocumentIdentifier = { uri: docUri.toString() };
                        // Forward the request to the delegate and return its response
                        return await this._evaluationDelegate.doEvaluate(textDocument, sourceCode, guestUser);
                    } catch (error) {
                        return {
                            error: `Error handling evaluation: ${error.message || "Unknown error"}`
                        };
                    }
                }
            );
        }

        this._connected = true;
    }

    async disconnect(): Promise<void> {
        if (this._service) {
            // Unregister any handlers
            this._service = null;
        }
        this._connected = false;
        this._evaluationDelegate = null;
    }

    dispose() {
        this.disconnect();
    }
}

export async function onLiveshareSession(callback: (r: vsls.Role, s: string) => void): Promise<Disposable> {
    const liveshare = await vsls.getApi();
    if (!liveshare) {
        throw new Error("LiveShare API not available");
    }

    // If we already have a session, call the callback immediately
    if (liveshare.session) {
        callback(liveshare.session.role, liveshare.session.id);
    }

    return liveshare.onDidChangeSession((event: vsls.SessionChangeEvent) => {
        callback(
            event.session?.role || vsls.Role.None,
            event.session?.id || null
        );
    });
}

