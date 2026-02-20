import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as defaults from './util/defaults';
import { SuperColliderContext, SclangState } from './context';

interface ConfYamlData {
    includes: string[];
    excludes: string[];
    error?: string;
}

export class SclangInfoWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'supercolliderSclangInfo';

    private _view?: vscode.WebviewView;
    private _context?: SuperColliderContext;
    private _stateDisposable?: vscode.Disposable;

    constructor(private readonly _extensionContext: vscode.ExtensionContext) { }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, enableCommandUris: true };

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'restart':
                    vscode.commands.executeCommand('supercollider.restart');
                    break;
                case 'openFile':
                    if (message.path) {
                        vscode.window.showTextDocument(vscode.Uri.file(message.path));
                    }
                    break;
            }
        });

        this.render();
    }

    setContext(context: SuperColliderContext) {
        this._stateDisposable?.dispose();
        this._context = context;
        this._stateDisposable = context.onStateChange(() => this.render());
        this.render();
    }

    refresh() {
        this.render();
    }

    private async render() {
        if (!this._view) return;

        const state = this._context?.state ?? 'stopped';

        const sclangPath = this._context?.resolvedSclangPath
            ?? vscode.workspace.getConfiguration().get<string>('supercollider.sclang.cmd')
            ?? defaults.sclangPath();

        // Prefer server-provided conf yaml data over client-side parsing
        let confYamlPath: string | null = this._context?.serverConfYamlPath ?? this._context?.resolvedConfYamlPath ?? null;
        if (!confYamlPath) {
            confYamlPath = vscode.workspace.getConfiguration().get<string>('supercollider.sclang.confYaml')
                ?? defaults.userConfigPath();
        }

        // If the path is a directory, append the yaml filename
        if (confYamlPath && !confYamlPath.endsWith('.yaml') && !confYamlPath.endsWith('.yml')) {
            confYamlPath = path.join(confYamlPath, 'sclang_conf.yaml');
        }

        let confData: ConfYamlData;
        if (this._context?.serverIncludePaths?.length > 0 || this._context?.serverExcludePaths?.length > 0) {
            // Use server-provided data
            confData = {
                includes: this._context.serverIncludePaths,
                excludes: this._context.serverExcludePaths,
            };
        } else {
            // Fall back to client-side yaml parsing
            confData = await this.readConfYaml(confYamlPath);
        }
        let version = this._context?.sclangVersion ?? "";
        let args = this._context?.sclangArgs ?? [];

        this._view.webview.html = this.getHtml(state, sclangPath, version, args, this._context?.startupFiles, confYamlPath, confData);
    }

    private async readConfYaml(filePath: string): Promise<ConfYamlData> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return this.parseConfYaml(content);
        } catch (e) {
            return { includes: [], excludes: [], error: `Could not read: ${e?.code ?? e}` };
        }
    }

    private parseConfYaml(content: string): ConfYamlData {
        const includes: string[] = [];
        const excludes: string[] = [];
        let currentSection: string[] | null = null;

        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed === 'includePaths:') {
                currentSection = includes;
            } else if (trimmed === 'excludePaths:') {
                currentSection = excludes;
            } else if (trimmed.startsWith('- ') && currentSection !== null) {
                let value = trimmed.slice(2).trim();
                // Strip quotes
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                currentSection.push(value);
            } else if (trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith('-') && trimmed.includes(':')) {
                currentSection = null;
            }
        }

        return { includes, excludes };
    }

    private getHtml(state: SclangState, sclangPath: string, version: string, args: string[], startupFiles: string[], confYamlPath: string, confData: ConfYamlData): string {
        let statusColor: string;
        let statusText: string;
        let argsStr = ""

        if (args) {
            argsStr = args.join(" ");
        }

        switch (state) {
            case 'running':
                statusColor = 'var(--vscode-testing-iconPassed)';
                statusText = 'Running';
                break;
            case 'starting':
                statusColor = 'var(--vscode-editorWarning-foreground)';
                statusText = 'Starting\u2026';
                break;
            case 'stopped':
            default:
                statusColor = 'var(--vscode-testing-iconFailed)';
                statusText = 'Stopped';
                break;
        }

        const esc = (s: string) => s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

        const openLink = (uri: string) => {
            return `command:vscode.open?${encodeURIComponent(JSON.stringify([uri]))}`
        };

        const sclangDir = esc(path.dirname(sclangPath));
        const sclangBin = esc(path.basename(sclangPath));

        let pathsHtml = '';

        if (confData.error) {
            pathsHtml += `<div class="empty-state">${esc(confData.error)}</div>`;
        } else if (confData.includes.length === 0 && confData.excludes.length === 0) {
            pathsHtml += `<div class="empty-state">No includes or excludes configured</div>`;
        } else {
            if (confData.includes.length > 0) {
                pathsHtml += `<div class="section-label">Includes</div><div class="path-list">`;
                for (const p of confData.includes) {
                    pathsHtml += `<div class="path-item" title="${esc(p)}">${esc(p)}</div>`;
                }
                pathsHtml += `</div>`;
            }

            if (confData.excludes.length > 0) {
                pathsHtml += `<div class="section-label">Excludes</div><div class="path-list">`;
                for (const p of confData.excludes) {
                    pathsHtml += `<div class="path-item excluded" title="${esc(p)}">${esc(p)}</div>`;
                }
                pathsHtml += `</div>`;
            }
        }

        let startupFilesHtml = ''
        if (startupFiles && startupFiles.length > 0) {
            for (const f of startupFiles) {
                startupFilesHtml += `<a class="conf-link" title="${esc(f)}" href="${openLink(f)}">${esc(f)}</a><br>`;
            }
        }

        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            padding: 10px 14px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            line-height: 1.4;
        }

        /* Status */
        .status-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
        }
        .status-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: ${statusColor};
            flex-shrink: 0;
        }
        .status-text {
            font-weight: 600;
            flex-grow: 1;
        }
        .restart-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            padding: 2px 8px;
            font-size: 12px;
            cursor: pointer;
            font-family: var(--vscode-font-family);
        }
        .restart-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        /* Sections */
        .divider {
            border: none;
            border-top: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
            margin: 10px 0;
        }
        .section-label {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            margin: 8px 0 4px 0;
        }

        /* Monospace values */
        .mono-value {
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            word-break: break-all;
            margin-bottom: 8px;
        }

        /* Links */
        .conf-link {
            display: inline-flex;
            align-items: center;
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
            cursor: pointer;
            font-size: 12px;
            margin-bottom: 4px;
        }
        .conf-link:hover {
            text-decoration: underline;
        }

        /* Path lists */
        .path-list {
            margin: 0 0 4px 0;
        }
        .path-item {
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            color: var(--vscode-foreground);
            padding: 1px 0 1px 8px;
            border-left: 2px solid var(--vscode-textLink-foreground);
            word-break: break-all;
            opacity: 0.85;
        }
        .path-item.excluded {
            border-left-color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground));
            opacity: 0.6;
        }

        /* Empty state */
        .empty-state {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            margin: 8px 0;
        }
    </style>
</head>
<body>
    <div class="status-row">
        <div class="status-indicator"></div>
        <span class="status-text">${statusText}</span>
        <button class="restart-btn" id="restartBtn">Restart</button>
    </div>

    <hr class="divider">

    <div class="section-label">version</div>
    <div class="mono-value" title="${esc(version)}">${version}</div>

    <div class="section-label">binary</div>
    <div class="mono-value" title="${esc(sclangPath)}">${sclangDir}/<b>${sclangBin}</b></div>

    <div class="section-label">arguments</div>
    <div class="mono-value" title="${esc(argsStr)}">${argsStr}</div>

    <hr class="divider">

    <div class="section-label">startup files</div>
    ${startupFilesHtml}

    <div class="section-label">sclang conf</div>
    <a class="conf-link" title="${esc(confYamlPath)}" href="${openLink(confYamlPath)}">${esc(confYamlPath)}</a>

    ${pathsHtml}

    <script>
        const vscode = acquireVsCodeApi();
        document.getElementById('restartBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'restart' });
        });
    </script>
</body>
</html>`;
    }
}
