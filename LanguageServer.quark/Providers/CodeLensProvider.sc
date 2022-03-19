// https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_codeAction
CodeLensProvider : LSPProvider {
	*methodNames {
		^[
			"textDocument/codeLens",
		]
	}
	*clientCapabilityName { ^"textDocument.codeLens" }
	*serverCapabilityName { ^"codeLensProvider" }

	init {
		|clientCapabilities|
	}

	options {
		^(
		)
	}

	handleRequest {
		|method, params|
		Log(CodeLensProvider).info("Handling: %", method);
		^nil
	}
}
