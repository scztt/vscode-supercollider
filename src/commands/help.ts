import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as url from 'url';
import * as vscode from 'vscode';
import {ViewColumn,
        workspace} from 'vscode';
import * as vscodelc from 'vscode-languageclient/node';

import {SuperColliderContext} from '../context';

const HelpPanelName = 'supercollider.help';

namespace SearchHelp
{

interface SearchHelpParams
{
    searchString: string
}
;

interface SearchHelpResult
{
    uri: string|undefined,
        rootUri: string|undefined,
}
;

export const type = new vscodelc.RequestType<SearchHelpParams, SearchHelpResult, void>('documentation/search');
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function getHtmlFromFile(path: string)
{
    path = path.replace('file://', '');

    return new Promise<string>((res, rej) => {
                                   fs.readFile(path, (err, data) => {
                                       if (err)
                                       {
                                           rej(err)
                                       }
                                       else
                                       {
                                           res(data.toString())
                                       }
                                   })});
}

function makeHTML(path: string)
{
    var result = `
        <!DOCTYPE html>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>C++ Reference</title>
        <style>
        body, html
        {
            margin: 0;
            padding: 0;
            height: 100%;
            overflow: hidden;
            background-color: #fff;
        }
        iframe
        {
            border: 0px;
        }
        </style> 
        <iframe id="frame" src="http://127.0.0.1:8080/${path}" width="100%" height="100%"></iframe>

        <script>
            window.onload = () => {
                // Add the postMessage handler
                const vscode = acquireVsCodeApi();
                window.addEventListener('message', (event) => {
                    // Check the origin of the message to ensure it's from a trusted source
                    if (event.origin == 'http://127.0.0.1:8080') {
                        vscode.postMessage(event.data)
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
                
                var frame = document.getElementById('frame');
                frame.onload = () => {
                    frame.contentWindow.postMessage({
                        command: 'init',
                        css: css
                    }, '*');
                }
            };
        </script>
        `

    return result
}

let server = null
let frontend_js: string|undefined;
let frontend_css: string|undefined;

async function searchHelpInActiveDocument(client: vscodelc.LanguageClient)
{
    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor)
        return null;

    const searchRange  = activeTextEditor.selection.isEmpty
                           ? activeTextEditor.document.getWordRangeAtPosition(activeTextEditor.selection.start)
                           : activeTextEditor.selection;
    const searchString = activeTextEditor.document.getText(searchRange);

    if (searchString.length > 0)
    {
        const result = await client.sendRequest(SearchHelp.type, {
            searchString : searchString,
        });

        launchServer(result.rootUri)

        let helpPath  = result.uri.replace(result.rootUri, '');

        let helpPanel = vscode.window.createWebviewPanel(
            HelpPanelName,
            HelpPanelName,
            ViewColumn.Beside,
            {
                enableFindWidget : true,
                retainContextWhenHidden : true,
                enableScripts : true
            });
        helpPanel.webview.html = makeHTML(helpPath);
        helpPanel.webview.onDidReceiveMessage(
            (message) => {
                switch (message.command)
                {
                case 'open_local_file': {
                    vscode.workspace.openTextDocument(url.fileURLToPath(message.href)).then(doc => { vscode.window.showTextDocument(doc); }, (err) => { vscode.window.showErrorMessage(err); });
                }
                }
            })
    }
}

export function activate(context: SuperColliderContext)
{
    readFrontendFiles();
    
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'supercollider.searchHelp',
            () => {
                searchHelpInActiveDocument(context.client)}));
}

export function deactivate(context: SuperColliderContext)
{
    if (!!server)
    {
        server.close();
        server = null;
    }
}

function readFrontendFiles()
{
    return new Promise<[ string, string ]>((res, rej) => {
        const maybeComplete = () => {
            if (frontend_css !== undefined && frontend_js !== undefined)
            {
                res([ frontend_css, frontend_js ])
            }
        }

        maybeComplete();

        fs.readFile(path.join(__dirname, 'help/frontend.css'), 'utf8', function(err, content) {
            if (err)
            {
                console.log('Could not find frontend.css');
                return;
            }

            frontend_css = content;
            maybeComplete();
        });

        fs.readFile(path.join(__dirname, 'help/frontend.js'), 'utf8', function(err, content) {
            if (err)
            {
                console.log('Could not find frontend.css');
                return;
            }

            frontend_js = content;
            maybeComplete();
        });
    });
}

async function launchServer(rootUri)
{
    if (!server)
    {
        server = http.createServer(async function(request, response) {
                         console.log('request starting...');

                         const [frontend_css, frontend_js] = await readFrontendFiles();

                         if (request.url == '//frontend.css')
                         {
                             // custom style
                             response.writeHead(200, {'Content-Type' : 'text/css'});
                             response.end(frontend_css, 'utf-8');
                         }

                         if (request.url == '//frontend.js')
                         {
                             // custom style
                             response.writeHead(200, {'Content-Type' : 'text/javascript'});
                             response.end(frontend_js, 'utf-8');
                         }

                         var filePath = url.fileURLToPath(rootUri + request.url);
                         if (filePath == './')
                         {
                             filePath = './index.html';
                         }

                         var extname     = path.extname(filePath);
                         var contentType = 'text/html';
                         switch (extname)
                         {
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

                         fs.readFile(filePath, function(error, content) {
                             if (error)
                             {
                                 if (error.code == 'ENOENT')
                                 {
                                     fs.readFile('./404.html', function(error, content) {
                                         response.writeHead(200, {'Content-Type' : contentType});
                                         response.end(content, 'utf-8');
                                     });
                                 }
                                 else
                                 {
                                     response.writeHead(500);
                                     response.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
                                     response.end();
                                 }
                             }
                             else
                             {
                                 response.writeHead(200, {'Content-Type' : contentType});
                                 response.end(content, 'utf-8');
                             }
                         });
                     })
                     .listen(8080);
    }
}