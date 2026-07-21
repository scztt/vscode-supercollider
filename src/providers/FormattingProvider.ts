import { DocumentFormattingEditProvider, Disposable, FormattingOptions, TextDocument, CancellationToken, ProviderResult, TextEdit, Position, Range, OutputChannel } from 'vscode';
import * as cp from 'child_process';

const EXIT_STRING = String.fromCharCode(4);
const EOF_STRING = String.fromCharCode(0);

class FormatResults {
    resolve: (t) => void;
    text: string;
};

export class SuperColliderFormatter implements DocumentFormattingEditProvider, Disposable {
    output: OutputChannel;
    formatterPath: string;
    formatterProcess: cp.ChildProcess | null = null;
    tabSize: Number;
    useSpaces: Boolean;
    listeners: FormatResults[] = [];

    constructor(output: OutputChannel, formatterPath: string, tabSize: Number, useSpaces: Boolean) {
        this.output = output;
        this.formatterPath = formatterPath;
        this.tabSize = tabSize;
        this.useSpaces = useSpaces;

        this.start();
    }

    restart() {
        this.end();
        this.start();
    }

    start() {
        if (!this.formatterProcess) {
            this.output.appendLine(`[formatter] spawn: ${this.spawnSpec.command} ${this.spawnSpec.args.join(' ')}`);
            let args = ['-i', this.tabSize.toString(), '-w'];
            if (!this.useSpaces) {
                args = [...args, '-t']
            }

            this.formatterProcess = cp.spawn(this.formatterPath, args, {
                stdio: 'pipe'
            });
            this.formatterProcess.stdout?.on('data', (stream) => {
                this.onData(stream);
            });
            this.formatterProcess.stderr?.on('data', (stream) => {
                this.output.appendLine(`[formatter] stderr: ${stream.toString().trimEnd()}`);
            });
            this.formatterProcess.on('exit', (code, signal) => {
                this.output.appendLine(`[formatter] exited code=${code} signal=${signal}`);
                this.formatterProcess = null;
                const pending = this.listeners;
                this.listeners = [];
                for (const l of pending) l.resolve(l.text);
            });
            this.formatterProcess.on('error', (err) => {
                this.output.appendLine(`[formatter] spawn error: ${err.message}`);
            });
        }
    }

    end() {
        if (this.formatterProcess) {
            if (this.formatterProcess.connected) {
                this.formatterProcess.stdin?.write(EXIT_STRING);
                this.formatterProcess.stdin?.end();
            }
            this.formatterProcess.kill();
            this.formatterProcess.disconnect()
            this.formatterProcess = null;
            this.listeners = [];
        }
    }

    provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]> {
        const text = document.getText();

        if (this.formatterProcess) {
            let promise = new Promise<string>((resolve) => {
                this.listeners.push({ resolve: resolve, text: "" });
                this.formatterProcess.stdin.cork();
                this.formatterProcess.stdin.write(text);
                this.formatterProcess.stdin.write(EOF_STRING);
                this.formatterProcess.stdin.uncork();
            });

            return new Promise<TextEdit[]>(async (resolve) => {
                let formatted = await promise;
                resolve(
                    [new TextEdit(new Range(
                        new Position(0, 0),
                        new Position(999999, 999999)
                    ), formatted)]
                )
            });
        }
    }

    onData(stream) {
        let chunks = stream.toString()
            .split(EOF_STRING);

        // chunks = chunks.filter(l => l.length > 0);
        if (chunks.length == 1) {
            this.listeners[0].text += chunks[0];
            return;
        }

        while (chunks.length > 1) {
            let listener = this.listeners[0];
            this.listeners = this.listeners.slice(1);
            const chunk = chunks[0];
            chunks = chunks.slice(1);

            if (!listener) {
                // this.output.appendLine("ERROR: Received data from formatter, but we weren't waiting on anything.");
                return;
            }

            listener.text += chunk
            listener.resolve(listener.text);
        }

        if (this.listeners.length > 0 && chunks[0].length > 0) {
            this.listeners[0].text += chunks[0];
        }
    }

    dispose() {
        this.end()
    }
}
