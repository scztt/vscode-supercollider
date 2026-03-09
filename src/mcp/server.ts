import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TextDocumentIdentifier } from 'vscode-languageclient/node';
import { SuperColliderContext, EvaluationResult } from '../context';
import { findRegion } from '../commands/evaluate';

let mcpServer: SuperColliderMcpServer | null = null;

function getMcpConfigPath(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0] ? path.join(folders[0].uri.fsPath, '.mcp.json') : null;
}

async function readMcpPort(): Promise<number | null> {
    const configPath = getMcpConfigPath();
    if (!configPath) return null;
    try {
        const content = await fs.promises.readFile(configPath, 'utf-8');
        const url = JSON.parse(content)?.mcpServers?.supercollider?.url;
        const match = url?.match(/:(\d+)\//);
        return match ? parseInt(match[1], 10) : null;
    } catch {
        return null;
    }
}

async function writeMcpConfig(port: number) {
    const configPath = getMcpConfigPath();
    if (!configPath) return;
    const config = {
        mcpServers: {
            supercollider: {
                type: 'sse',
                url: `http://localhost:${port}/sse`
            }
        }
    };
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 4) + '\n');
}

export async function startMcpServer(outputChannel: vscode.OutputChannel): Promise<SuperColliderMcpServer | null> {
    if (mcpServer) {
        outputChannel.appendLine('MCP server is already running');
        return mcpServer;
    }

    try {
        let port = await readMcpPort();
        if (!port) {
            port = Math.floor(Math.random() * 55536) + 10000;
            await writeMcpConfig(port);
        }

        mcpServer = new SuperColliderMcpServer();
        await mcpServer.start(port);
        outputChannel.appendLine(`MCP server started on port ${port}`);
        return mcpServer;
    } catch (err) {
        mcpServer = null;
        outputChannel.appendLine(`Failed to start MCP server: ${err}`);
        return null;
    }
}

export function getMcpServer(): SuperColliderMcpServer | null {
    return mcpServer;
}

export class SuperColliderMcpServer {
    private server: FastMCP;
    private context: SuperColliderContext | null = null;
    private outputBuffer: string[] = [];
    private outputDisposable: vscode.Disposable | null = null;
    private maxOutputLines = 200;

    constructor() {
        this.server = new FastMCP({
            name: 'SuperCollider',
            version: '0.1.0',
        });

        this.registerTools();
    }

    setContext(context: SuperColliderContext) {
        this.context = context;
        this.captureOutput();
    }

    private captureOutput() {
        this.outputDisposable?.dispose();
        this.outputDisposable = this.context!.onOutputMessage((message) => {
            const lines = message.text.split('\n');
            this.outputBuffer.push(...lines);
            if (this.outputBuffer.length > this.maxOutputLines) {
                this.outputBuffer = this.outputBuffer.slice(-this.maxOutputLines);
            }
        });
    }

    private requireContext(): SuperColliderContext {
        if (!this.context) {
            throw new Error('sclang is still starting up — try again in a moment');
        }
        return this.context;
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
                const result = await this.requireContext().doEvaluate(doc, args.code, 'mcp');
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
                const result = await this.requireContext().doEvaluate(doc, code, 'mcp');
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
                const result = await this.requireContext().doEvaluate(doc, code, 'mcp');
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
                this.requireContext().executeCommand('supercollider.internal.cmdPeriod');
                return 'Stopped all sounds.';
            },
        });

        // Boot server
        this.server.addTool({
            name: 'boot_server',
            description: 'Boot the default SuperCollider audio server.',
            execute: async () => {
                this.requireContext().executeCommand('supercollider.internal.bootServer');
                return 'Boot server command sent.';
            },
        });

        // Reboot server
        this.server.addTool({
            name: 'reboot_server',
            description: 'Reboot the default SuperCollider audio server.',
            execute: async () => {
                this.requireContext().executeCommand('supercollider.internal.rebootServer');
                return 'Reboot server command sent.';
            },
        });

        // Kill all servers
        this.server.addTool({
            name: 'kill_all_servers',
            description: 'Kill all running SuperCollider audio servers.',
            execute: async () => {
                this.requireContext().executeCommand('supercollider.internal.killAllServers');
                return 'Kill all servers command sent.';
            },
        });

        // Restart sclang (recompiles class library)
        this.server.addTool({
            name: 'restart_sclang',
            description: 'Restart the sclang interpreter. This recompiles the entire SuperCollider class library. Use after modifying .sc class files. Takes several seconds to complete.',
            execute: async () => {
                await this.requireContext().restart();
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

                await this.requireContext().doEvaluate(doc, code, 'mcp');

                // queryAllNodes prints to post window asynchronously — give it time
                await new Promise(r => setTimeout(r, 500));

                const newLines = this.outputBuffer.slice(startLen);
                return newLines.join('\n').trim() || '(no output received)';
            },
        });

        // Go to definition: find source location for a class or method name
        this.server.addTool({
            name: 'goto_definition',
            description: 'Find the source file and line number for a SuperCollider class or method name. Returns file path and line number for each definition found.',
            parameters: z.object({
                name: z.string().describe('Class name (e.g. "SinOsc") or method name (e.g. "ar", "midicps")'),
            }),
            execute: async (args) => {
                const doc: TextDocumentIdentifier = { uri: 'untitled:mcp-eval' };
                const code = `(
                    var word = ${JSON.stringify(args.name)}.asSymbol;
                    var results = [];
                    if (word.asString[0].isUpper and: { word.asClass.notNil }) {
                        var class = word.asClass;
                        results = results.add((
                            type: "class",
                            name: class.name,
                            file: class.filenameSymbol,
                            line: File(class.filenameSymbol.asString, "r")
                                .readAllString.charToLineChar(class.charPos)[0]
                        ));
                    } {
                        Class.allClasses.do { |c|
                            c.methods.do { |m|
                                if (m.name == word) {
                                    results = results.add((
                                        type: "method",
                                        class: m.ownerClass.name,
                                        name: m.name,
                                        file: m.filenameSymbol,
                                        line: File(m.filenameSymbol.asString, "r")
                                            .readAllString.charToLineChar(m.charPos)[0]
                                    ));
                                }
                            }
                        };
                    };
                    results.asCompileString
                )`;
                const result = await this.requireContext().doEvaluate(doc, code, 'mcp');
                return this.formatEvalResult(result);
            },
        });

        // Find methods: look up method signatures across all classes
        this.server.addTool({
            name: 'find_methods',
            description: 'Find all implementations of a method name across all SuperCollider classes. Returns class, method name, arguments with defaults, and source location.',
            parameters: z.object({
                name: z.string().describe('Method name to search for (e.g. "ar", "new", "play")'),
                className: z.string().optional().describe('Optional: filter to methods on this class and its superclasses'),
            }),
            execute: async (args) => {
                const doc: TextDocumentIdentifier = { uri: 'untitled:mcp-eval' };
                const classFilter = args.className
                    ? `var filterClass = ${JSON.stringify(args.className)}.asSymbol.asClass;
                       if (filterClass.notNil) {
                           var chain = [filterClass] ++ filterClass.superclasses;
                           methods = methods.select { |m| chain.includes(m.ownerClass) };
                       };`
                    : '';
                const code = `(
                    var word = ${JSON.stringify(args.name)}.asSymbol;
                    var methods = Class.allClasses.collect(_.methods).flatten(1)
                        .select { |m| m.name == word };
                    ${classFilter}
                    methods.collect { |m|
                        var args = m.argNames !? _[1..] ?? [];
                        var defaults = m.prototypeFrame;
                        (
                            class: m.ownerClass.name,
                            method: m.name,
                            args: args.collect { |a, i|
                                var def = defaults[i + 1];
                                if (def.notNil) {
                                    "%=%".format(a, def)
                                } { a.asString }
                            }.join(", "),
                            file: m.filenameSymbol,
                            line: File(m.filenameSymbol.asString, "r")
                                .readAllString.charToLineChar(m.charPos)[0]
                        )
                    }.asCompileString
                )`;
                const result = await this.requireContext().doEvaluate(doc, code, 'mcp');
                return this.formatEvalResult(result);
            },
        });

        // Render class/topic help documentation as markdown
        this.server.addTool({
            name: 'render_help',
            description: [
                'Render SuperCollider help documentation for a class or topic as markdown.',
                'Can render the full document, a specific section, or a specific method.',
                'Sections: "description", "classmethods", "instancemethods", "examples", or a custom section title.',
                'Methods: use methodName param (e.g. "ar", "new") — searches both class and instance methods.',
            ].join(' '),
            parameters: z.object({
                name: z.string().describe('Class name (e.g. "SinOsc") or topic path (e.g. "Guides/Getting-Started")'),
                section: z.string().optional().describe('Optional: render only this section. One of "description", "classmethods", "instancemethods", "examples", or a custom section title.'),
                methodName: z.string().optional().describe('Optional: render only the documentation for this method (e.g. "ar", "new", "play"). Overrides section.'),
                filePath: z.string().optional().describe('Optional: absolute path to write the markdown file to. If omitted, returns the content directly.'),
            }),
            execute: async (args) => {
                const doc: TextDocumentIdentifier = { uri: 'untitled:mcp-eval' };
                const nameStr = JSON.stringify(args.name);

                // Build the rendering expression based on what's requested
                let renderExpr: string;
                if (args.methodName) {
                    // Find and render a specific method node, walking superclasses if needed
                    const methodStr = JSON.stringify(args.methodName);
                    renderExpr = `
                        var findMethodNode = { |aRoot|
                            var body = aRoot.children[1];
                            var found, foundSecId;
                            var sectionIds = [\\CLASSMETHODS, \\INSTANCEMETHODS];
                            sectionIds.do { |secId|
                                body.children.do { |section|
                                    if (section.id == secId) {
                                        section.children.do { |node|
                                            if ([\\CMETHOD, \\IMETHOD, \\METHOD].includes(node.id)) {
                                                var names = node.children[0].children.collect(_.text);
                                                if (names.indexOfEqual(${methodStr}).notNil) {
                                                    found = node;
                                                    foundSecId = secId;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                            [found, foundSecId]
                        };
                        var result = findMethodNode.(root);
                        var methodNode = result[0], methodSecId = result[1];
                        var foundDoc = doc, foundRoot = root;

                        // Walk superclasses if not found in this class
                        if (methodNode.isNil and: { doc.isClassDoc }) {
                            var cls = doc.klass;
                            block { |break|
                                cls !? { cls.superclasses } !? _.do { |superclass|
                                    var superDocKey = "Classes/" ++ superclass.name;
                                    var superDoc = SCDoc.documents[superDocKey];
                                    if (superDoc.notNil) {
                                        var superRoot = SCDoc.parseFileFull(superDoc.fullPath);
                                        if (superRoot.notNil) {
                                            result = findMethodNode.(superRoot);
                                            methodNode = result[0];
                                            methodSecId = result[1];
                                            if (methodNode.notNil) {
                                                foundDoc = superDoc;
                                                foundRoot = superRoot;
                                                break.()
                                            };
                                        };
                                    };
                                };
                            };
                        };

                        if (methodNode.isNil) {
                            "Method '%' not found in help for '%' or any superclass".format(${methodStr}, ${nameStr})
                        } {
                            var stream;
                            // Initialize renderer classvars by rendering the parent section to a throwaway stream
                            SCDocMarkdownRenderer.renderSection(CollStream(""), foundDoc, foundRoot, methodSecId);
                            // Now render just the method node with state properly initialized
                            stream = CollStream("");
                            SCDocMarkdownRenderer.renderSubTree(stream, methodNode);
                            if (foundDoc != doc) {
                                stream.collection ++ "\\n\\n*Documented in: " ++ foundDoc.title ++ "*"
                            } {
                                stream.collection
                            }
                        }`;
                } else if (args.section) {
                    // Render a specific section
                    const sectionMap: Record<string, string> = {
                        'description': '\\DESCRIPTION',
                        'classmethods': '\\CLASSMETHODS',
                        'instancemethods': '\\INSTANCEMETHODS',
                        'examples': '\\EXAMPLES',
                    };
                    const sectionKey = args.section.toLowerCase();
                    const sectionId = sectionMap[sectionKey];

                    if (sectionId) {
                        renderExpr = `
                            var stream = CollStream("");
                            SCDocMarkdownRenderer.renderSection(stream, doc, root, ${sectionId});
                            stream.collection`;
                    } else {
                        // Custom section title — search by node.text
                        const titleStr = JSON.stringify(args.section);
                        renderExpr = `
                            var body = root.children[1];
                            var node, stream;

                            stream = CollStream("");
                            node = body.children.detect { |n|
                                (n.id == \\SECTION) and: { n.text == ${titleStr} }
                            };

                            if (node.isNil) {
                                "Section '%' not found in help for '%'".format(${titleStr}, ${nameStr})
                            } {
                                SCDocMarkdownRenderer.renderSubTree(stream, node);
                                stream.collection
                            }`;
                    }
                } else if (args.filePath) {
                    // Full doc to file
                    renderExpr = `
                        SCDocMarkdownRenderer.renderToFile(${JSON.stringify(args.filePath)}, doc, root);
                        ${JSON.stringify(args.filePath)}`;
                } else {
                    // Full doc to string
                    renderExpr = `
                        var stream = CollStream("");
                        SCDocMarkdownRenderer.renderOnStream(stream, doc, root);
                        stream.collection`;
                }

                const code = `(
                    var name = ${nameStr};
                    var docKey, doc, root;

                    try { SCDoc.indexAllDocuments } {};

                    docKey = "Classes/" ++ name;
                    doc = SCDoc.documents[docKey];
                    if (doc.isNil) {
                        doc = SCDoc.documents[name];
                        docKey = name;
                    };

                    if (doc.isNil) {
                        "No help document found for: %".format(name)
                    } {
                        root = SCDoc.parseFileFull(doc.fullPath);
                        if (root.isNil) {
                            "Failed to parse help document for: %".format(name)
                        } {
                            ${renderExpr}
                        }
                    }
                )`;
                const result = await this.requireContext().doEvaluate(doc, code, 'mcp');
                return this.formatEvalResult(result);
            },
        });
    }

    async start(port: number) {
        await this.server.start({
            transportType: 'httpStream',
            httpStream: { port },
        });
    }

    async stop() {
        await this.server.stop();
        this.outputDisposable?.dispose();
        this.outputDisposable = null;
    }

    dispose() {
        this.outputDisposable?.dispose();
        this.outputDisposable = null;
        this.server?.stop().catch(() => {});
    }
}
