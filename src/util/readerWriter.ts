import * as dgram from 'dgram';
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
    buffered: String
    contentLength: number

    constructor(socket: dgram.Socket)
    {
        super();
        this.buffered = "";
        this.contentLength = null;
        this.socket = socket;
        this.socket.on('message', (msg, rinfo) => {
            if (!!this.callback)
            {
                let str  = msg.toString();
                this.buffered = this.buffered + str;

                if (this.contentLength === null)
                {
                    const headerRe = /Content-Length: ([0-9]+)\r\n\r(\n)/
                    let match      = this.buffered.match(headerRe)
                    if (match.length > 0)
                    {
                        this.contentLength = parseInt(match[1]);
                        let headerLength   = match[0].length;
                        this.buffered      = this.buffered.slice(match.index + headerLength);
                    }
                }

                const bufferSize = getBinarySize(this.buffered);
                if (bufferSize >= this.contentLength)
                {
                    let message = this.buffered.slice(0, bufferSize);
                    this.buffered = this.buffered.slice(this.contentLength);
                    this.contentLength = null;
                    
                    let json           = JSON.parse(message);
                    this.callback(json);
                }

            }
        });
    }

    listen(callback: DataCallback)
    {
        this.callback = callback;
        return {dispose : () => { this.callback= null; }};
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
            let data     = JSON.stringify(msg)
            let dataSize = data.length;

            data         = `Content-Length: ${dataSize+1}\r\n\r\n${data}\n`;

            this.socket.send(data, this.port, this.address, (err) => {
                if (err)
                {
                    console.log(err);
                }
                else
                {
                }
            });

            res();
        });
    }

    end()
    {
        this.socket.close();
    }
}