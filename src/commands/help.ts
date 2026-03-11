import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as url from 'url';
import * as vscode from 'vscode';
import {
    ViewColumn,
    workspace
} from 'vscode';
import * as vscodelc from 'vscode-languageclient/node';
import { TextDocumentIdentifier } from 'vscode-languageclient/node';

import { SuperColliderContext } from '../context';

const HelpPanelName = 'supercollider.help';

namespace SearchHelp {

    interface SearchHelpParams {
        searchString: string
    }
    ;

    interface SearchHelpResult {
        uri: string | undefined,
        rootUri: string | undefined,
    }
    ;

    export const type = new vscodelc.RequestType<SearchHelpParams, SearchHelpResult, void>('documentation/search');
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function getHtmlFromFile(path: string) {
    path = path.replace('file://', '');

    return new Promise<string>((res, rej) => {
        fs.readFile(path, (err, data) => {
            if (err) {
                rej(err)
            }
            else {
                res(data.toString())
            }
        })
    });
}

function makeHTML(path: string, port: number) {
    var result = `
        <!DOCTYPE html>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SuperCollider Help</title>
        <style>
        body, html
        {
            margin: 0;
            padding: 0;
            height: 100%;
            overflow: hidden;
            background-color: var(--vscode-sideBar-background, #fff);
        }
        iframe
        {
            border: 0;
            display: block;
            width: 100%;
            height: 100%;
            position: absolute;
            top: 0;
            left: 0;
        }
        </style>
        <iframe id="frame" src="http://127.0.0.1:${port}/${path}"></iframe>

        <script>
            //# sourceURL=help.js
            window.onload = () => {
                const vscode = acquireVsCodeApi();
                vscode.setState({ helpPath: ${JSON.stringify(path)} });
                var frame = document.getElementById('frame');

                for (const command of ['selectAll', 'copy', 'paste', 'cut', 'undo', 'redo']) {
                    document.addEventListener(command, (e) => {
                        frame.contentWindow.postMessage({'command': 'execCommand', 'data': command}, '*');
                        frame.contentDocument.execCommand(command);
                    });
                }
                window.addEventListener('message', (event) => {
                    // Check the origin of the message to ensure it's from a trusted source
                    if (event.origin == 'http://127.0.0.1:${port}') {
                        if (event.data.command == 'open-local-file') {
                        vscode.postMessage(event.data)
                        } else if (event.data.command == 'open-code') {
                            vscode.postMessage(event.data)
                        } else if (event.data.command == 'navigate') {
                            vscode.setState({ helpPath: event.data.path });
                        }
                    }
                });
                const style = document.getElementsByTagName('html')[0].style;
                var css = {}

                for (var i = 0; i < style.length; i++) {
                    const name = style[i];
                    if (name.indexOf('--vscode') >= 0) {
                        css[name] = style.getPropertyValue(name);
                    }
                }
                
                function sendInit() {
                    frame.contentWindow.postMessage({
                        command: 'init',
                        css: css
                    }, '*');
                }
                frame.onload = sendInit;
                sendInit();
            };
        </script>
        `

    return result
}

let server = null
let serverPort: number | null = null
let lastRootUri: string | null = null;
let helpContext: SuperColliderContext | null = null;
let frontendCache: { js: string, css: string } | null = null;
let helpPanels: vscode.WebviewPanel[] = [];
let extensionContext: vscode.ExtensionContext | null = null;

async function searchHelpInActiveDocument(context: SuperColliderContext) {
    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor)
        return null;

    const searchRange = activeTextEditor.selection.isEmpty
        ? activeTextEditor.document.getWordRangeAtPosition(activeTextEditor.selection.start)
        : activeTextEditor.selection;
    const searchString = activeTextEditor.document.getText(searchRange);

    if (searchString.length > 0) {
        const result = await context.client.sendRequest(SearchHelp.type, {
            searchString: searchString,
        });

        await launchServer(result.rootUri)
        lastRootUri = result.rootUri;
        extensionContext?.globalState.update('helpRootUri', result.rootUri);

        let helpPath = result.uri.replace(result.rootUri, '');

        let helpPanel = vscode.window.createWebviewPanel(
            HelpPanelName,
            HelpPanelName,
            ViewColumn.Beside,
            {
                enableFindWidget: true,
                retainContextWhenHidden: true,
                enableScripts: true
            });
        setupHelpPanel(helpPanel, helpPath);
    }
}

function setupHelpPanel(panel: vscode.WebviewPanel, helpPath: string) {
    panel.webview.html = makeHTML(helpPath, serverPort!);
    helpPanels.push(panel);
    panel.onDidDispose(() => {
        helpPanels = helpPanels.filter(p => p !== panel);
    });
    panel.webview.onDidReceiveMessage(
        (message) => {
            switch (message.command) {
                case 'open-local-file': {
                    vscode.workspace.openTextDocument(url.fileURLToPath(message.href)).then(doc => { vscode.window.showTextDocument(doc, vscode.ViewColumn.One); }, (err) => { vscode.window.showErrorMessage(err); });
                    break;
                }
                case 'open-code': {
                    vscode.workspace.openTextDocument({ content: message.code, language: 'supercollider' }).then(doc => { vscode.window.showTextDocument(doc, vscode.ViewColumn.One); });
                    break;
                }
            }
        });
}

export async function searchHelp(context: SuperColliderContext) {
    helpContext = context;
    await searchHelpInActiveDocument(context);
}

export function activate(context: vscode.ExtensionContext) {
    getFrontendFiles();
    // Restore help panels from previous session
    context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer(HelpPanelName, {
            async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: { helpPath?: string }) {
                const helpPath = state?.helpPath;
                if (!helpPath || !lastRootUri) {
                    panel.dispose();
                    return;
                }
                await launchServer(lastRootUri);
                setupHelpPanel(panel, helpPath);
            }
        })
    );
    // Persist lastRootUri across sessions
    lastRootUri = context.globalState.get('helpRootUri') ?? null;
    extensionContext = context;
}

export function deactivate() {
    for (const panel of helpPanels) {
        panel.dispose();
    }
    helpPanels = [];
    if (!!server) {
        server.close();
        server = null;
        serverPort = null;
    }
}

async function getFrontendFiles(): Promise<{ js: string, css: string }> {
    if (frontendCache) return frontendCache;
    const [css, js] = await Promise.all([
        fs.promises.readFile(path.join(__dirname, 'help/frontend.css'), 'utf8'),
        fs.promises.readFile(path.join(__dirname, 'help/frontend.js'), 'utf8'),
    ]);
    frontendCache = { js, css };
    return frontendCache;
}

async function launchServer(rootUri): Promise<void> {
    if (!server) {
        return new Promise((resolve, reject) => {
            try {
                server = http.createServer(async function (request, response) {
                    console.log('request starting...');

                    try {
                        const frontend = await getFrontendFiles();
                        const urlPath = request.url?.replace(/^\/+/, '/') ?? '';

                        if (urlPath == '/frontend.css' || urlPath == '/static/frontend.css') {
                            response.writeHead(200, { 'Content-Type': 'text/css' });
                            response.end(frontend.css, 'utf-8');
                            return;
                        }

                        if (urlPath == '/frontend.js' || urlPath == '/static/frontend.js') {
                            response.writeHead(200, { 'Content-Type': 'text/javascript' });
                            response.end(frontend.js, 'utf-8');
                            return;
                        }

                        var filePath = url.fileURLToPath(rootUri + urlPath);
                        if (urlPath == './') {
                            filePath = './index.html';
                        }

                        var extname = path.extname(filePath);
                        var contentType = 'text/html';
                        switch (extname) {
                            case '.js':
                                contentType = 'text/javascript';
                                break;
                            case '.css':
                                contentType = 'text/css';
                                break;
                            case '.json':
                                contentType = 'application/json';
                                break;
                            case '.png':
                                contentType = 'image/png';
                                break;
                            case '.jpg':
                                contentType = 'image/jpg';
                                break;
                            case '.wav':
                                contentType = 'audio/wav';
                                break;
                        }

                        // On-demand rendering: ask sclang to render .html help files before serving
                        if (extname === '.html' && helpContext) {
                            try {
                                const helpFileUrl = "file:/" + filePath;
                                const scCode = `SCDoc.prepareHelpForURL(URI(${JSON.stringify(helpFileUrl)}))`;
                                const doc: TextDocumentIdentifier = { uri: 'untitled:help-render' };
                                await helpContext.doEvaluate(doc, scCode, 'help');
                            } catch (e) {
                                console.error('Help on-demand render failed, serving from disk:', e);
                            }
                        }

                        fs.readFile(filePath, function (error, content) {
                            if (error) {
                                if (error.code == 'ENOENT') {
                                    fs.readFile('./404.html', function (error, content) {
                                        response.writeHead(200, { 'Content-Type': contentType });
                                        response.end(content, 'utf-8');
                                    });
                                }
                                else {
                                    response.writeHead(500);
                                    response.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
                                    response.end();
                                }
                            }
                            else {
                                response.writeHead(200, { 'Content-Type': contentType });
                                response.end(content, 'utf-8');
                            }
                        });
                    } catch (requestError) {
                        console.error('Error handling request:', requestError);
                        response.writeHead(500);
                        response.end('Internal server error');
                    }
                });

                server.on('error', (error: Error) => {
                    console.error('Help server error:', error);
                    vscode.window.showErrorMessage(`Failed to start help server: ${error.message}`);
                    server = null;
                    serverPort = null;
                    reject(error);
                });

                const port = Math.floor(Math.random() * 55536) + 10000;
                serverPort = port;
                server.listen(port, () => {
                    console.log(`Help server started on port ${port}`);
                    resolve();
                });
            } catch (error) {
                console.error('Failed to create help server:', error);
                vscode.window.showErrorMessage(`Failed to start help server: ${(error as Error).message}`);
                server = null;
                serverPort = null;
                reject(error);
            }
        });
    }
}