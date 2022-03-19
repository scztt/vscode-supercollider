// https://microsoft.github.io/language-server-protocol/specifications/specification-current/#initialize
TextDocumentProvider : LSPProvider {
	*methodNames {
		^[
			"textDocument/didOpen",
			"textDocument/didChange",
			"textDocument/didClose",
		]
	}
	*clientCapabilityName { ^"textDocument.synchronization" }
	*serverCapabilityName { ^"textDocumentSync" }

	init {}

	options {
		// https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocumentSyncOptions
		^(
			openClose: true,
			change: 1 // Full
		)
	}

	handleRequest {
		|method, params|
		Log(TextDocumentProvider).info("Handling: %", method);

		switch(
			method,
			'textDocument/didChange', {
				this.didChange(
					params["textDocument"],
					params["contentChanges"][0]["text"]
				)
			},
			'textDocument/didOpen', {
				// @TODO
			},
			'textDocument/didClose', {
				// @TODO
			},
			{
				Error("Couldn't handle method: %".format(method)).throw
			}
		);

		^nil
	}

	didChange {
		|document, string|
		document.initFromIDE(document.quuid, "something", string, true, "/");
	}
}
