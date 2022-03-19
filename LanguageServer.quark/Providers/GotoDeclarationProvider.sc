// https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_declaration
GotoDeclarationProvider : LSPProvider {
	*methodNames {
		^[
			"textDocument/declaration",
		]
	}
	*clientCapabilityName { ^"textDocument.declaration" }
	*serverCapabilityName { ^"declarationProvider" }

	init {
		|clientCapabilities|
		// https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#declarationClientCapabilities
	}

	options {
		// https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocumentSyncOptions
		^()
	}

	handleRequest {
		|method, params|
		var wordAtCursor = LSPDatabase.getDocumentWordAt(
			params["textDocument"],
			params["position"]["line"],
			params["position"]["character"]
		);

		Log(GotoDeclarationProvider).info("Found word at cursor: %", wordAtCursor);

		^nil
	}
}
