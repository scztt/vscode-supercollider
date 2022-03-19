// https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_implementation
ExecuteProvider : LSPProvider {
	*methodNames {
		^[
			"textDocument/executeSelection",
		]
	}
	*clientCapabilityName { ^"textDocument.execution" }
	*serverCapabilityName { ^"executionProvider" }

	init {
		|clientCapabilities|
	}

	options {
		^()
	}

	handleRequest {
		|method, params|
		var source, document, function, result;

		source = params["sourceCode"];
		document = params["textDocument"];

		thisProcess.nowExecutingPath = document.path;

		result = ();

		function = source.compile();
		if (function.isNil) {
			result[\compileError] = "Compile error?"
		} {
			try {
				result[\result] = function.value();
			} {
				|error|
				result[\error] = error.errorString;
			};
		};

		thisProcess.nowExecutingPath = nil;

		^result
	}
}
