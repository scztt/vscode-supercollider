import * as dgram from 'dgram';
import {Message} from 'vscode-jsonrpc';
import {AbstractMessageReader, AbstractMessageWriter, DataCallback} from 'vscode-languageclient/node';

export class UDPMessageReader extends AbstractMessageReader
{
    callback: DataCallback;
    socket: dgram.Socket;

    constructor(socket: dgram.Socket)
    {
        super();
        this.socket = socket;
        this.socket.on('message', (msg, rinfo) => {
            if (!!this.callback)
            {
                let str  = msg.toString();
                let json = JSON.parse(str);
                this.callback(json);
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
            this.socket.send(JSON.stringify(msg), this.port, this.address, (err) => {
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