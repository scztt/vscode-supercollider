import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { TextDocumentIdentifier } from 'vscode-languageclient/node';
import { SuperColliderContext, EvaluationResult } from '../context';
import { findRegion } from '../commands/evaluate';

export class SuperColliderMcpServer {
    private server: FastMCP;
    private context: SuperColliderContext;
    private outputBuffer: string[] = [];
    private outputDisposable: vscode.Disposable | null = null;
    private maxOutputLines = 200;

    constructor(context: SuperColliderContext) {
        this.context = context;

        this.server = new FastMCP({
            name: 'SuperCollider',
            version: '0.1.0',
        });

        this.captureOutput();
        this.registerTools();
    }

    private captureOutput() {
        this.outputDisposable = this.context.onOutputMessage((message) => {
            const lines = message.text.split('\n');
            this.outputBuffer.push(...lines);
            if (this.outputBuffer.length > this.maxOutputLines) {
                this.outputBuffer = this.outputBuffer.slice(-this.maxOutputLines);
            }
        });
    }

    private formatEvalResult(result: EvaluationResult): { content: { type: 'text', text: string }[] } {
        if (result.compileError) {
            return {
                content: [
                    { type: 'text', text: `ERROR (compile): ${result.compileError}` },
                ],
            };
        }
        if (result.error) {
            return {
                content: [
                    { type: 'text', text: `ERROR (runtime): ${result.error}` },
                ],
            };
        }
        return {
            content: [
                { type: 'text', text: result.result ?? '(no result)' },
            ],
        };
    }

    private registerTools() {
        // Evaluate arbitrary SuperCollider code
        this.server.addTool({
            name: 'evaluate',
            description: 'Evaluate a SuperCollider code string in sclang and return the result. Use this to execute any SC code.',
            parameters: z.object({
                code: z.string().describe('SuperCollider code to evaluate'),
            }),
            execute: async (args) => {
                const doc: TextDocumentIdentifier = { uri: 'untitled:mcp-eval' };
                const result = await this.context.doEvaluate(doc, args.code, 'mcp');
                return this.formatEvalResult(result);
            },
        });

        // Evaluate code from a file at a specific line range
        this.server.addTool({
            name: 'evaluate_file',
            description: 'Evaluate SuperCollider code from a file at a specific line range. Lines are 1-indexed.',
            parameters: z.object({
                filePath: z.string().describe('Absolute path to the .sc or .scd file'),
                startLine: z.number().int().min(1).describe('Start line (1-indexed, inclusive)'),
                endLine: z.number().int().min(1).describe('End line (1-indexed, inclusive)'),
            }),
            execute: async (args) => {
                const content = await fs.promises.readFile(args.filePath, 'utf-8');
                const lines = content.split('\n');

                if (args.startLine > lines.length) {
                    return { content: [{ type: 'text' as const, text: `Error: startLine ${args.startLine} is beyond end of file (${lines.length} lines)` }] };
                }

                const endLine = Math.min(args.endLine, lines.length);
                const code = lines.slice(args.startLine - 1, endLine).join('\n');

                const uri = vscode.Uri.file(args.filePath).toString();
                const doc: TextDocumentIdentifier = { uri };
                const result = await this.context.doEvaluate(doc, code, 'mcp');
                return this.formatEvalResult(result);
            },
        });

        // Evaluate a parenthesis-delimited region containing the given line
        this.server.addTool({
            name: 'evaluate_region',
            description: 'Evaluate a parenthesis-delimited region in a SuperCollider file. Finds the enclosing (...) region around the given line and evaluates it. This is equivalent to Cmd+Enter in the editor.',
            parameters: z.object({
                filePath: z.string().describe('Absolute path to the .sc or .scd file'),
                line: z.number().int().min(1).describe('Any line number inside the region (1-indexed)'),
            }),
            execute: async (args) => {
                const content = await fs.promises.readFile(args.filePath, 'utf-8');
                const lines = content.split('\n');
                const lineIndex = args.line - 1;

                if (lineIndex >= lines.length) {
                    return { content: [{ type: 'text' as const, text: `Error: line ${args.line} is beyond end of file (${lines.length} lines)` }] };
                }

                const region = findRegion(lines, lineIndex);
                if (!region) {
                    return { content: [{ type: 'text' as const, text: `Error: no enclosing (...) region found around line ${args.line}` }] };
                }

                const code = lines.slice(region.start, region.end + 1).join('\n');
                const uri = vscode.Uri.file(args.filePath).toString();
                const doc: TextDocumentIdentifier = { uri };
                const result = await this.context.doEvaluate(doc, code, 'mcp');
                return this.formatEvalResult(result);
            },
        });

        // Get recent post window output
        this.server.addTool({
            name: 'get_post_window',
            description: 'Get recent output from the SuperCollider post window.',
            parameters: z.object({
                lines: z.number().int().min(1).max(200).default(50).describe('Number of recent lines to return'),
            }),
            execute: async (args) => {
                const recent = this.outputBuffer.slice(-args.lines);
                return recent.join('\n') || '(post window is empty)';
            },
        });

        // Stop all sounds
        this.server.addTool({
            name: 'cmd_period',
            description: 'Stop all running sounds and scheduled tasks in SuperCollider (equivalent to Cmd+Period).',
            execute: async () => {
                this.context.executeCommand('supercollider.internal.cmdPeriod');
                return 'Stopped all sounds.';
            },
        });

        // Boot server
        this.server.addTool({
            name: 'boot_server',
            description: 'Boot the default SuperCollider audio server.',
            execute: async () => {
                this.context.executeCommand('supercollider.internal.bootServer');
                return 'Boot server command sent.';
            },
        });

        // Reboot server
        this.server.addTool({
            name: 'reboot_server',
            description: 'Reboot the default SuperCollider audio server.',
            execute: async () => {
                this.context.executeCommand('supercollider.internal.rebootServer');
                return 'Reboot server command sent.';
            },
        });

        // Kill all servers
        this.server.addTool({
            name: 'kill_all_servers',
            description: 'Kill all running SuperCollider audio servers.',
            execute: async () => {
                this.context.executeCommand('supercollider.internal.killAllServers');
                return 'Kill all servers command sent.';
            },
        });

        // Restart sclang (recompiles class library)
        this.server.addTool({
            name: 'restart_sclang',
            description: 'Restart the sclang interpreter. This recompiles the entire SuperCollider class library. Use after modifying .sc class files. Takes several seconds to complete.',
            execute: async () => {
                await this.context.restart();
                return 'sclang restarted and class library recompiled.';
            },
        });

        // Dump node tree and return the output
        this.server.addTool({
            name: 'dump_node_tree',
            description: 'Dump the SuperCollider server node tree and return it. Shows all running synths and groups.',
            parameters: z.object({
                controls: z.boolean().default(false).describe('Include control (parameter) values in the dump'),
            }),
            execute: async (args) => {
                const code = `s.queryAllNodes(${args.controls})`;
                const doc: TextDocumentIdentifier = { uri: 'untitled:mcp-eval' };
                const startLen = this.outputBuffer.length;

                await this.context.doEvaluate(doc, code, 'mcp');

                // queryAllNodes prints to post window asynchronously — give it time
                await new Promise(r => setTimeout(r, 500));

                const newLines = this.outputBuffer.slice(startLen);
                return newLines.join('\n').trim() || '(no output received)';
            },
        });
    }

    async start(port: number) {
        await this.server.start({
            transportType: 'httpStream',
            httpStream: { port },
        });
    }

    dispose() {
        this.outputDisposable?.dispose();
    }
}
