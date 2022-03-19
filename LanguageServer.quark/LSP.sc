LSPConnection {
	classvar <lspConnection;
	classvar <providers, <>preprocessor;
	classvar readyMsg = "***LSP READY***";

	var <>inPort, <>outPort;
	var socket;

	*initClass {
		var settings;

		Class.initClassTree(Log);

		// Initialization
		providers = ();

		// All params objects are passed through preprocessor.
		// This can normalize common param fields.
		// @TODO each LSPProvider should have it's own preprocessor?
		preprocessor = {
			|params|

			params["textDocument"] !? {
				|doc|
				if (doc["text"].notNil) {
					params["textDocument"] = LSPDocument.syncFromIDE(
						doc["uri"],
						doc["text"]
					);
				} {
					params["textDocument"] = LSPDocument.findByQUuid(doc["uri"])
				}
			};

			params["params"] !? _["position"] !? {
				|position|
				position["line"] = position["line"].asInteger;
				position["character"] = position["character"].asInteger;
			}
		};

		settings = this.envirSettings();

		if (settings[\enabled].asBoolean) {
			StartUp.add({
				lspConnection = LSPConnection().start;
			})
		}
	}

	*new {
		|settings|
		^super.new.init(this.envirSettings.copy.addAll(settings));
	}

	*envirSettings {
		^(
			enabled: "SCLANG_LSP_ENABLE".getenv().notNil,
			inPort: "SCLANG_LSP_CLIENTPORT".getenv() ?? { 57210 } !? _.asInteger,
			outPort: "SCLANG_LSP_SERVERPORT".getenv() ?? { 57211 } !? _.asInteger
		)
	}

	init {
		|settings|
		inPort = settings[\inPort];
		outPort = settings[\outPort];
	}

	start {
		// @TODO: What do we do before start / after stop? Errors?
		Log(LSPConnection).level = \debug;
		Log(LSPConnection).info("Starting language server, inPort: % outPort:%", inPort, outPort);

		socket = NetAddr("127.0.0.1", outPort);
		thisProcess.openTCPPort(inPort);

		thisProcess.recvRawfunc = {
			|time, replyAddr, msg|
			this.prOnReceived(time, replyAddr, msg)
		};

		// @TODO Is this the only "default" provider we want?
		this.addProvider(InitializeProvider(this, {}));

		readyMsg.postln;
	}

	stop {
		// @TODO Unregister and close ports?
	}

	serverInfo {
		// @TODO What should go here?
		^(
			"name": "sclang:LSPConnection",
			"version": "0.1"
		)
	}

	addProvider {
		|provider|
		provider.methodNames.do {
			|methodName|
			methodName = methodName.asSymbol;

			if (providers[methodName].isNil) {
				Log(LSPConnection).info("Adding provider for method '%'", methodName);
			} {
				Log(LSPConnection).warning("Overwriting provider for method '%'", methodName);
			};

			providers[methodName] = provider;
		}
	}

	prOnReceived {
		|time, replyAddr, message|

		Log(LSPConnection).info("Message received: %, %, %", time, replyAddr, message);

		this.prHandleMessage(
			this.prParseMessage(message)
		)
	}

	prParseMessage {
		|message|
		var object;

		try {
			object = message.parseJSON;
		} {
			|e|
			// @TODO: Improve error messaging and behavior.
			"Problem parsing message (%)".format(e).error;
		};

		^object
	}

	prEncodeMessage {
		|object|
		var message;

		try {
			message = object.toJSON();
		} {
			|e|
			// @TODO: Improve error messaging and behavior.
			"Problem encoding message (%)".format(e).error;
			^this
		};

		socket.sendRaw(message)
	}

	prHandleMessage {
		|object|
		var id, method, params, provider, deferredResult;

		id 		= object["id"];
		method 	= object["method"].asSymbol;
		params 	= object["params"];

		provider = providers[method];

		if (provider.isNil) {
			Log(LSPConnection).info("No provider found for method: %", method)
		} {
			Log(LSPConnection).info("Found method provider: %", provider);

			// Preprocess param values into a usable state
			preprocessor.value(params);

			Deferred().using({
				provider.handleRequest(method, params).postln;
			}).then({
				|result|

				if (result == provider) {
					"Provider % is returning *itself* from handleRequest instead of providing an explicit nil or non-nil return value!".format(provider.class).warn;
				};

				if (result.notNil) {
					this.prHandleResponse(id, result)
				}
			}, {
				|error|
				// @TODO handle error
				error.reportError
			});
		}
	}

	prHandleResponse {
		|id, result|
		var message = (
			id: id,
			result: result
		).toJSON;

		Log(LSPConnection).info("Responding to id: % with: %", id, message);

		this.prSendMessage(message);
	}

	prSendMessage {
		|message|
		// @TODO message should use JSON-RPC Content-Length header, support multi-part sending for long messages.
		socket.sendRaw(message);
	}
}

