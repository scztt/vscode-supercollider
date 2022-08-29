import * as vscode from 'vscode';
import {MarkdownString,
        Range,
        TextEditor} from 'vscode';
import * as uuid from 'vscode-languageclient/lib/common/utils/uuid';
import * as vscodelc from 'vscode-languageclient/node';
import {ProtocolRequestType,
        StaticRegistrationOptions,
        TextDocumentFeature,
        TextDocumentRegistrationOptions,
        WorkDoneProgressOptions} from 'vscode-languageclient/node';

import {SuperColliderContext} from '../context';

function ensure(target, key)
{
    if (target[key] === void 0)
    {
        target[key] = {};
    }
    return target[key];
}

// These decorators are applied to executed regions of code during/after execution.
const executeDecorator = vscode.window.createTextEditorDecorationType({
    backgroundColor : new vscode.ThemeColor('inputOption.activeBackground'),
    isWholeLine : true,
});
const successDecorator = vscode.window.createTextEditorDecorationType({
    backgroundColor : new vscode.ThemeColor('inputValidation.infoBackground'),
    overviewRulerColor : new vscode.ThemeColor('inputValidation.infoBackground'),
    outline : 'border-left-width: 1px',
    isWholeLine : true,
});
const errorDecorator   = vscode.window.createTextEditorDecorationType({
    backgroundColor : new vscode.ThemeColor('inputValidation.errorBackground'),
    overviewRulerColor : new vscode.ThemeColor('inputValidation.infoBackground'),
    outline : 'border-left-width: 1px',
    isWholeLine : true,
  });
let executeCount       = 0;
const decoratorTimeout = 5000;

// Start and end execution actions
function onEndExecute(textEditor: TextEditor, range: Range, responseText: string, isError: boolean)
{
    textEditor.setDecorations(executeDecorator, []);

    if (isError)
    {
        textEditor.setDecorations(successDecorator, [])
        textEditor.setDecorations(errorDecorator, [ {
                                      range : range,
                                      hoverMessage : new MarkdownString(responseText)
                                  } ]);
    }
    else
    {
        textEditor.setDecorations(errorDecorator, [])
        textEditor.setDecorations(successDecorator, [ {
                                      range : range,
                                      hoverMessage : new MarkdownString(responseText)
                                  } ]);
    }
}

function onStartExecute(textEditor: TextEditor, range: Range)
{
    let currentExecuteCount = ++executeCount;

    textEditor.setDecorations(successDecorator, [])
    textEditor.setDecorations(errorDecorator, [])
    textEditor.setDecorations(executeDecorator, [ {
                                  range : range,
                                  hoverMessage : "Executed the thing"
                              } ]);

    setTimeout(() => {
        // Execution has timed out, so clear - don't clear if we've had another execute in the mean time
        if (executeCount == currentExecuteCount)
        {
            textEditor.setDecorations(executeDecorator, []);
        }
    }, decoratorTimeout);

    return (text: string, isError: boolean) => {
        if (executeCount == currentExecuteCount)
        {
            onEndExecute(textEditor, range, text, isError)
        }
    }
}

function currentDocumentSelection()
{
    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor)
        return null;

    return activeTextEditor.selection;
}

function currentDocumentLine()
{
    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor)
        return null;

    let selection = activeTextEditor.selection;
    let startLine = activeTextEditor.document.lineAt(selection.start);
    let endLine   = activeTextEditor.document.lineAt(selection.end);
    let range     = new Range(
            startLine.range.start,
            endLine.range.end);

    return range;
}

function currentDocumentRegion()
{
    const activeTextEditor = vscode.window.activeTextEditor;
    const document         = activeTextEditor.document;

    if (!activeTextEditor)
        return null;

    let selection = activeTextEditor.selection;
    let startLine = document.lineAt(selection.start);
    let endLine   = document.lineAt(selection.end);

    let startRE   = new RegExp(/^\(\s*$/);
    let endRE     = new RegExp(/^\s*\)\s*$/);

    while (!startRE.test(startLine.text))
    {
        if (startLine.lineNumber == 0)
        {
            startLine = null;
            break;
        }
        else
        {
            startLine = document.lineAt(startLine.lineNumber - 1);
        }
    };

    if (startLine !== null)
    {
        while (!endRE.test(endLine.text))
        {
            if (endLine.lineNumber == document.lineCount - 1)
            {
                endLine = null;
                break;
            }
            else
            {
                endLine = document.lineAt(endLine.lineNumber + 1);
            }
        }
    }

    if (startLine !== null && endLine !== null)
    {
        let range = new Range(
            startLine.range.start,
            endLine.range.end);

        return range;
    }
    else
    {
        return null;
    }
}

interface ExecuteSelectionProvider {
    executeString(document: vscode.TextDocument, range: vscode.Selection): vscode.ProviderResult<ExecuteSelectionRequest.ExecuteSelectionResult>;
}

export function registerExecuteProvider(context: SuperColliderContext, provider): vscode.Disposable
{
    let subscriptions: vscode.Disposable[] = [];

    subscriptions.push(
        vscode.commands.registerCommand(
            'supercollider.executeSelection',
            () => {
                const document = vscode.window.activeTextEditor.document;
                const range    = currentDocumentSelection();
                if (range !== null)
                {
                    provider.executeString(document, range)
                }
            }));

    subscriptions.push(
        vscode.commands.registerCommand(
            'supercollider.executeLine',
            () => {
                const document = vscode.window.activeTextEditor.document;
                const range    = currentDocumentLine();
                if (range !== null)
                {
                    provider.executeString(document, range)
                }
            }));

    subscriptions.push(
        vscode.commands.registerCommand(
            'supercollider.executeRegion',
            () => {
                const document = vscode.window.activeTextEditor.document;
                const range    = currentDocumentRegion();
                if (range !== null)
                {
                    provider.executeString(document, range)
                }
            }));

    return new vscode.Disposable(() => {
        subscriptions.forEach((d) => d.dispose());
    })
}

interface ExecuteSelectionOptions extends WorkDoneProgressOptions {
}

interface ExecuteSelectionRegistrationOptions extends ExecuteSelectionOptions, TextDocumentRegistrationOptions, StaticRegistrationOptions {
}

namespace ExecuteSelectionRequest
{
export const method = 'textDocument/executeSelection';

export interface ExecuteSelectionParams {
    textDocument: vscodelc.TextDocumentIdentifier,
        sourceCode: string
}

export interface ExecuteSelectionResult {
    compileError: string|undefined,
        result: string|undefined,
        error: string|undefined
}

export const type = new ProtocolRequestType<ExecuteSelectionParams, ExecuteSelectionResult, never, void, ExecuteSelectionRegistrationOptions>(method);
}

async function executeString(client: vscodelc.BaseLanguageClient, document: vscode.TextDocument, range: Range): Promise<ExecuteSelectionRequest.ExecuteSelectionResult>
{
    const activeTextEditor = vscode.window.activeTextEditor;

    if (!activeTextEditor)
        return;

    const uri           = vscode.Uri.file(document.fileName);
    const docIdentifier = vscodelc.TextDocumentIdentifier.create(uri.toString());

    let finishFunc      = onStartExecute(activeTextEditor, range);

    const result        = client.sendRequest(ExecuteSelectionRequest.type, {
        textDocument : docIdentifier,
        sourceCode : activeTextEditor.document.getText(range)
    });

    result.then((result) => {
        if (result.result !== undefined)
        {
            const prefix = '⇒ ';
            vscode.window.showInformationMessage(prefix + result.result);
            finishFunc(result.result, false);
        }
        else if (result.compileError !== undefined)
        {
            const prefix = '⇏ ';
            vscode.window.showErrorMessage(prefix + result.compileError);
            finishFunc(result.compileError, true);
        }
        else if (result.error !== undefined)
        {
            const prefix = '⇏ ';
            vscode.window.showErrorMessage(prefix + result.error);
            finishFunc(result.error, true);
        }
    });

    return result;
}

// @TODO A lot of boilerplate is required to register this as a feature, but in the end we just trigger the commands roughly the same way.
// Is there benefit here, apart from that we can specify client capabilities and pass options back to our client (which we do not do now anyway...)?
export class ExecuteSelectionFeature extends TextDocumentFeature<ExecuteSelectionOptions|boolean, ExecuteSelectionRegistrationOptions, ExecuteSelectionProvider>
{
    _context: SuperColliderContext;

    constructor(client, context: SuperColliderContext)
    {
        super(client, ExecuteSelectionRequest.type);
        this._context = context;
    }
    fillClientCapabilities(capabilities)
    {
        (ensure(ensure(capabilities, 'textDocument'), 'execution')).executeSelection = true;
    }

    initialize(capabilities, documentSelector)
    {
        const options = this.getRegistrationOptions(documentSelector, capabilities.executionProvider);
        if (!options)
        {
            return;
        }
        this.register({
            id : uuid.generateUuid(),
            registerOptions : options
        });
    }

    registerLanguageProvider(): [ vscode.Disposable, ExecuteSelectionProvider ]
    {
        const provider: ExecuteSelectionProvider = {
            executeString : (document: vscode.TextDocument, range: vscode.Selection) => {
                const client                  = this._client;

                const provideExecuteSelection = (document: vscode.TextDocument, range: vscode.Selection) => {
                    return executeString(client, document, range);
                };

                return provideExecuteSelection(document, range);
            }
        };

        return [ registerExecuteProvider(this._context, provider), provider ];
    }
};