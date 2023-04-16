import * as dgram from 'dgram';
import { TextDecoder } from 'util';
import {Message} from 'vscode-jsonrpc';
import {AbstractMessageReader,
        AbstractMessageWriter,
        DataCallback} from 'vscode-languageclient/node';

function getBinarySize(string)
{
    return Buffer.byteLength(string, 'utf8');
}

export class UDPMessageReader extends AbstractMessageReader
{
    callback: DataCallback;
    socket: dgram.Socket;
    buffered: Uint8Array
    contentLength: number

    constructor(socket: dgram.Socket)
    {
        super();
        this.buffered      = new Uint8Array(0);
        this.contentLength = null;
        this.socket        = socket;
        
        let decoder       = new TextDecoder();

        this.socket.on('message', (msg, rinfo) => {
            if (!!this.callback)
            {   
                console.log(`Received: ${msg.length} bytes`);
                this.buffered = new Uint8Array([...this.buffered, ...msg ]);

                if (this.contentLength === null)
                {
                    const headerRe = /Content-Length: ([0-9]+)\r\n\r(\n)/
                    const str      = decoder.decode(this.buffered);
                    let match      = str.match(headerRe)
                    if (match.length > 0)
                    {
                        const contentLength = this.contentLength = parseInt(match[1]);
                        console.log(`contentLength: ${contentLength} bytes`);
                        let headerLength   = match[0].length;
                        this.buffered      = this.buffered.slice(match.index + headerLength);
                    }
                }

                // const bufferSize = getBinarySize(this.buffered);
                const bufferSize = this.buffered.length;
                console.log(`buffer is now : ${bufferSize} bytes`);
                if (bufferSize >= this.contentLength)
                {
                    console.log(`buffer is filled`);
                    let contentLength = this.contentLength;
                    let message       = decoder.decode(this.buffered.slice(0, this.contentLength));
                    this.buffered      = this.buffered.slice(this.contentLength);
                    this.contentLength = null;

                    let json           = JSON.parse(message);

                    console.log(`unprocessed buffer remaining : ${this.buffered.length} bytes`);

                    this.callback(json);
                }
            }
        });
    }

    listen(callback: DataCallback)
    {
        this.callback = callback;
        return {dispose : () => { this.callback = null; }};
    };
}

export class UDPMessageWriter extends AbstractMessageWriter
{
    socket: dgram.Socket;
    port: number;
    address: string;

    constructor(socket: dgram.Socket, port: number, address: string)
    {
        super();
        this.socket  = socket;
        this.port    = port;
        this.address = address;
    }

    write(msg: Message)
    {
        return new Promise<void>((res, err) => {
            let data = JSON.stringify(msg);
            let dataSize = Buffer.byteLength(data, 'utf8');
            let dataLength = data.length;

            data             = `Content-Length: ${dataSize + 1}\r\n\r\n${data}\n`;

            const packetSize = Buffer.byteLength(data, 'utf8');
            const bufferSize = this.socket.getSendBufferSize() - 1;

            for (let offset = 0; offset < packetSize; offset += bufferSize)
            {
                const size = Math.min(packetSize - offset, bufferSize)
                this.socket.send(data, offset, size, this.port, this.address, (err) => {
                    if (err)
                    {
                        console.log(err);
                    }

                    res();
                 });
            }
        });
    }

    end()
    {
        this.socket.close();
    }
}