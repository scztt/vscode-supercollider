// https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_completion
TextDocumentCompletionProvider : LSPProvider {
	*methodNames { ^["textDocument/completion"] }
	*clientCapabilityName { ^"textDocument.completion" }
	*serverCapabilityName { ^"completionProvider" }

	init {
		|clientCapabilities|
		// @TODO VSCode supports most capabilities. Do we need to modify our behavior for clients that don't?
	}

	// https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#completionOptions
	options {
		^(
			// @TODO Fetch these from LSPCompletionHandler
			triggerCharacters: [".", "(", "~"],

			// @TODO These are overridden by commit chars for each completion - do we need?
			allCommitCharacters: [],

			resolveProvider: false,
			completionItem: (
				labelDetailsSupport: true
			)
		)
	}

	handleRequest {
		|method, params|
		var doc, line, char, triggerCharacters;

		triggerCharacters = params["context"]["triggerCharacter"];
		#doc, line, char = this.getDocLineChar(params);

		LSPDatabase.getDocumentLine(doc, line) !? {
			|lineString|
			lineString = lineString[0..char];
			^LSPCompletionHandler.handleCompletion(lineString, triggerCharacters);
		} ?? {
			^nil
		}
	}
}
