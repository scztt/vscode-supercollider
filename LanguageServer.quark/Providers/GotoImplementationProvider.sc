// https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_implementation
GotoImplementationProvider : LSPProvider {
	*methodNames {
		^[
			"textDocument/implementation",
		]
	}
	*clientCapabilityName { ^"textDocument.implementation" }
	*serverCapabilityName { ^"implementationProvider" }

	init {
		|clientCapabilities|
	}

	options {
		^()
	}

	handleRequest {
		|method, params|
		Log(GotoImplementationProvider).info("Handling: %", method);

		^nil;
	}
}
