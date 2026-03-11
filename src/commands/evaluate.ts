import * as vscode from 'vscode';
import {
    MarkdownString,
    Range,
    TextEditor,
    Uri
} from 'vscode';
import * as uuid from 'vscode-languageclient/lib/common/utils/uuid';
import * as vscodelc from 'vscode-languageclient/node';
import {
    CancellationToken,
    integer,
    ProtocolRequestType,
    StaticRegistrationOptions,
    TextDocumentLanguageFeature,
    TextDocumentRegistrationOptions,
    WorkDoneProgressOptions
} from 'vscode-languageclient/node';

import { SuperColliderContext, OutputMessage, EvaluationResult, EvaluationDelegate } from '../context';
import { evaluateHelpSelection } from './help';

function ensure(target, key) {
    if (target[key] === void 0) {
        target[key] = {};
    }
    return target[key];
}

let _globalOutputChannel: vscode.OutputChannel;

// These decorators are applied to evaluated regions of code during/after execution.
const evaluateDecorator = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(50, 50, 255, 0.05)",
    isWholeLine: true,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
});

const successDecorator = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(0, 255, 200, 0.05)",
    isWholeLine: true,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

const errorDecorator = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(255, 0, 0, 0.05)",
    isWholeLine: true,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
});

let evaluateUID = 0;

const configuration = vscode.workspace.getConfiguration()
const decoratorTimeout = 5000;

import * as vsls from 'vsls';

// Start and end execution actions
async function onEndEvaluate(textEditor: TextEditor, range: Range, responseText: string, isError: boolean, flashDelay: Promise<void>) {
    await flashDelay;
    textEditor.setDecorations(evaluateDecorator, []);

    if (isError) {
        textEditor.setDecorations(successDecorator, [])
        textEditor.setDecorations(errorDecorator, [{
            range: range,
            hoverMessage: new MarkdownString(responseText),
        }]);
    }
    else {
        textEditor.setDecorations(errorDecorator, [])
        textEditor.setDecorations(successDecorator, [{
            range: range,
            hoverMessage: new MarkdownString(responseText)
        }]);
    }
}

function onStartEvaluate(textEditor: TextEditor, range: Range) {
    let currentEvaluateUID = ++evaluateUID;

    textEditor.setDecorations(successDecorator, [])
    textEditor.setDecorations(errorDecorator, [])
    textEditor.setDecorations(evaluateDecorator, [{
        range: range,
        hoverMessage: "Evaluated the thing"
    }]);

    setTimeout(() => {
        // Execution has timed out, so clear - don't clear if we've had another evaluate in the mean time
        if (evaluateUID == currentEvaluateUID) {
            textEditor.setDecorations(evaluateDecorator, []);
        }
    }, decoratorTimeout);

    const decoratorFlashTime = configuration.get<integer>('supercollider.evaluate.flash_time', 50);
    let evaluateFlashDelay = new Promise<void>((res, err) => {
        setTimeout(res, decoratorFlashTime);
    });

    return (text: string, isError: boolean) => {
        if (evaluateUID == currentEvaluateUID) {
            onEndEvaluate(textEditor, range, text, isError, evaluateFlashDelay)
        }
    }
}

function currentDocumentSelection() {
    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor)
        return null;

    return activeTextEditor.selection;
}

function currentDocumentLine() {
    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor)
        return null;

    let selection = activeTextEditor.selection;
    let startLine = activeTextEditor.document.lineAt(selection.start);
    let endLine = activeTextEditor.document.lineAt(selection.end);
    let range = new Range(
        startLine.range.start,
        endLine.range.end);

    return range;
}

// Find a parenthesis-delimited region around a given line index (0-indexed).
// Works on an array of line strings. Returns { start, end } line indices or null.
export function findRegion(lines: string[], lineIndex: number): { start: number, end: number } | null {
    const startRE = /^\(\s*(\/\/)?\s*(.*)\s*$/;

    // Search backward for opening paren line
    let start = lineIndex;
    while (start >= 0 && !startRE.test(lines[start])) {
        start--;
    }
    if (start < 0) return null;

    // Track paren depth forward from the start line
    let parenDepth = 0;
    let inComment = false;
    let inLineComment = false;
    let inString = false;
    let inSymbol = false;
    let end = start;

    while (end < lines.length) {
        let lastCh;
        for (const ch of lines[end]) {
            const parsing = !inComment && !inLineComment && !inString && !inSymbol;

            if (!inComment && !inLineComment && !inSymbol && ch == "\"") {
                inString = !inString;
            }
            else if (!inComment && !inLineComment && !inString && ch == "\'") {
                inSymbol = !inSymbol;
            }
            else if (parsing && ch == "/" && lastCh == "/") {
                inLineComment = true;
            }
            else if (parsing && ch == "*" && lastCh == "/") {
                inComment = true;
            }
            else if (ch == "/" && lastCh == "*") {
                inComment = false;
            }
            else if (parsing && ch == "(") {
                parenDepth++;
            }
            else if (parsing && ch == ")") {
                parenDepth--;
            }

            lastCh = ch;
        }

        inLineComment = false;

        if (parenDepth == 0) {
            break;
        }

        if (end == lines.length - 1) {
            return null;
        }

        end++;
    }

    if (parenDepth !== 0) return null;

    return { start, end };
}

function currentDocumentRegion() {
    const activeTextEditor = vscode.window.activeTextEditor;
    const document = activeTextEditor.document;

    if (!activeTextEditor)
        return null;

    let selection = activeTextEditor.selection;
    const lineIndex = selection.start.line;
    const lines: string[] = [];
    for (let i = 0; i < document.lineCount; i++) {
        lines.push(document.lineAt(i).text);
    }

    const region = findRegion(lines, lineIndex);
    if (!region) return null;

    return new Range(
        document.lineAt(region.start).range.start,
        document.lineAt(region.end).range.end
    );
}

interface EvaluateSelectionProvider {
    evaluateString(document: vscode.TextDocument, range: Range): vscode.ProviderResult<EvaluateSelectionRequest.EvaluateSelectionResult>;
}

export function registerEvaluateProvider(context: SuperColliderContext, provider): vscode.Disposable {
    let subscriptions: vscode.Disposable[] = [];
    let lastEvaluated: Map<Uri, string[]> = new Map();

    subscriptions.push(
        vscode.commands.registerCommand(
            'supercollider.evaluateSelection',
            async (documentUri, inputRange) => {
                if (!documentUri && evaluateHelpSelection()) return;
                const document = documentUri ? await vscode.workspace.openTextDocument(vscode.Uri.parse(documentUri)) : vscode.window.activeTextEditor.document;
                // Now you have the TextDocument
                let range: Range = (inputRange != null)
                    ? new vscode.Selection(
                        new vscode.Position(inputRange['start']['line'], inputRange['start']['character']),
                        new vscode.Position(inputRange['end']['line'], inputRange['end']['character']))
                    : currentDocumentSelection();

                if (range == null || range.isEmpty) {
                    range = currentDocumentLine();
                }

                if (range !== null) {
                    provider.evaluateString(document, range)
                }
            }));

    subscriptions.push(
        vscode.commands.registerCommand(
            'supercollider.evaluateLine',
            () => {
                if (evaluateHelpSelection()) return;
                const document = vscode.window.activeTextEditor.document;
                const range = currentDocumentLine();
                if (range !== null) {
                    provider.evaluateString(document, range)
                }
            }));

    subscriptions.push(
        vscode.commands.registerCommand(
            'supercollider.evaluateRegion',
            () => {
                if (evaluateHelpSelection()) return;
                const document = vscode.window.activeTextEditor.document;
                const range = currentDocumentRegion();
                if (range !== null) {
                    provider.evaluateString(document, range)
                }
            }));

    subscriptions.push(
        vscode.commands.registerCommand(
            'supercollider.evaluateRegionByName',
            async () => {
                const document = vscode.window.activeTextEditor.document;
                let codeLensFeature = context.client.getFeature(vscodelc.CodeLensRequest.method);
                let documentSymbolProvider = context.client.getFeature(vscodelc.DocumentSymbolRequest.method);
                if (codeLensFeature && documentSymbolProvider) {
                    const cancel = {
                        isCancellationRequested: false,
                        onCancellationRequested: new vscode.EventEmitter().event
                    };

                    const lenses = await codeLensFeature.getProvider(document).provider.provideCodeLenses(document, cancel);
                    const symbols = await documentSymbolProvider.getProvider(document).provideDocumentSymbols(document, cancel);

                    const options: vscode.QuickPickItem[] = lenses.map((lens, i) => {
                        var regionName = symbols[i].name;
                        return {
                            label: regionName,
                            description: lens.command.command,
                            command: lens.command.command,
                        }
                    });

                    let quickPick = vscode.window.createQuickPick();

                    const lastRegions = lastEvaluated.get(document.uri) || [];
                    quickPick.placeholder = 'Evaluate a region by name';
                    quickPick.items = options;
                    quickPick.canSelectMany = true;

                    const preselected = options.filter((item) => lastRegions.includes(item.label));
                    if (preselected.length == 1) {
                        quickPick.activeItems = preselected;
                    } else {
                        quickPick.activeItems = quickPick.selectedItems = preselected;
                    }
                    quickPick.show();

                    const selection = await new Promise<readonly vscode.QuickPickItem[] | undefined>((resolve) => {
                        quickPick.onDidAccept(() => {
                            if (quickPick.selectedItems.length > 0) {
                                resolve(quickPick.selectedItems);
                            } else {
                                resolve(quickPick.activeItems);
                            }
                            quickPick.hide();
                        });
                        quickPick.onDidHide(() => {
                            resolve(undefined);
                            quickPick.dispose();
                        });
                    });

                    if (selection) {
                        lastEvaluated.set(document.uri, selection.map((item) => item.label));
                        for (let item of selection) {

                            vscode.commands.executeCommand(
                                'supercollider.evaluateSelection',
                                ...lenses[options.indexOf(item)].command.arguments);
                            ;
                        }
                    }
                }

            }));

    return new vscode.Disposable(() => {
        subscriptions.forEach((d) => d.dispose());
    })
}

interface EvaluateSelectionOptions extends WorkDoneProgressOptions {
}

interface EvaluateSelectionRegistrationOptions extends EvaluateSelectionOptions, TextDocumentRegistrationOptions, StaticRegistrationOptions {
}

interface EvaluateSelectionMiddleware {
}

namespace EvaluateSelectionRequest {
    export const method = 'textDocument/evaluateSelection';

    export interface EvaluateSelectionParams {
        textDocument: vscodelc.TextDocumentIdentifier,
        sourceCode: string,
        guestUser?: string
    }

    export interface EvaluateSelectionResult {
        compileError: string | undefined,
        result: string | undefined,
        error: string | undefined
    }

    export const type = new ProtocolRequestType<EvaluateSelectionParams, EvaluateSelectionResult, never, void, EvaluateSelectionRegistrationOptions>(method);
}

async function evaluateString(delegate: EvaluationDelegate, client, document: vscode.TextDocument, range: Range): Promise<EvaluateSelectionRequest.EvaluateSelectionResult> {
    const activeTextEditor = vscode.window.activeTextEditor;
    const liveshare = await vsls.getApi();
    const isLiveShareGuest = liveshare?.session?.role == vsls.Role.Guest;

    if (!activeTextEditor)
        return;

    const uri = vscode.Uri.file(document.fileName);
    const docIdentifier = vscodelc.TextDocumentIdentifier.create(uri.toString());

    const finishFunc = onStartEvaluate(activeTextEditor, range);
    const result = delegate.doEvaluate(docIdentifier, activeTextEditor.document.getText(range));

    result.then((result) => {
        if (result.result !== undefined) {
            // const prefix = '⇒ ';
            // vscode.window.showInformationMessage(prefix + result.result);
            finishFunc(result.result, false);
        }
        else if (result.compileError !== undefined) {
            // const prefix = '⇏ ';
            // vscode.window.showErrorMessage(prefix + result.compileError);
            finishFunc(result.compileError, true);
        }
        else if (result.error !== undefined) {
            // const prefix = '⇏ ';
            // vscode.window.showErrorMessage(prefix + result.error);
            finishFunc(result.error, true);
        }
    });

    return result;

}

// @TODO A lot of boilerplate is required to register this as a feature, but in the end we just trigger the commands roughly the same way.
// Is there benefit here, apart from that we can specify client capabilities and pass options back to our client (which we do not do now anyway...)?
export class EvaluateSelectionFeature extends TextDocumentLanguageFeature<
    EvaluateSelectionOptions | boolean, EvaluateSelectionRegistrationOptions, EvaluateSelectionProvider, EvaluateSelectionMiddleware> {

    _context: SuperColliderContext;
    _outputChannel: vscode.OutputChannel;
    _evaluationDelegate: EvaluationDelegate;
    private outputSubscription: vscode.Disposable | null = null;

    constructor(client, context: SuperColliderContext, evaluationDelegate: EvaluationDelegate) {
        super(client, EvaluateSelectionRequest.type);
        this._context = context;
        this._evaluationDelegate = evaluationDelegate;
    }

    set evaluationDelegate(value: EvaluationDelegate) {
        this._evaluationDelegate = value;
    }

    fillClientCapabilities(capabilities) {
        (ensure(ensure(capabilities, 'textDocument'), 'evaluation')).evaluateSelection = true;
    }

    initialize(capabilities, documentSelector) {
        const options = this.getRegistrationOptions(documentSelector, capabilities.executionProvider);
        if (!options) {
            return;
        }
        this.register({
            id: uuid.generateUuid(),
            registerOptions: options
        });
    }

    registerLanguageProvider(): [vscode.Disposable, EvaluateSelectionProvider] {
        const provider: EvaluateSelectionProvider = {
            evaluateString: (document: vscode.TextDocument, range: Range) => {
                const that = this;
                const client = this._client;

                const provideEvaluateSelection = (document: vscode.TextDocument, range: Range) => {
                    return evaluateString(that._evaluationDelegate, client, document, range);
                };

                return provideEvaluateSelection(document, range);
            }
        };

        const disposable = vscode.Disposable.from(registerEvaluateProvider(this._context, provider));
        return [disposable, provider];
    }
};