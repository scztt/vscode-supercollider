// Handle completions where the prefix looks like an environment variable, e.g.:
//   ~objec
+LSPCompletionHandler {
	*environmentVariableHandler {
		^LSPCompletionHandler.prNew(
			name: "environment_variable",
			trigger: "~",
			prefixHandler: {
				|prefix|
				// @TODO improve regex / parsing?
				if (prefix.isEmpty || "\\W+?$".matchRegexp(prefix)) {
					true
				} {
					nil
				}
			},
			action: {
				|prefix, trigger, completion, provideCompletionsFunc|
				var results;

				// @TODO Matching from current environment - this is probably as good as we can do, right?
				results = currentEnvironment.keys.collect(_.asString);

				if (completion.size > 0) {
					results = results.select({ |k| k.beginsWith(completion) })
				};

				// @TODO Move dictionary constricture to LSPDatabase?
				results = results.asArray.sort.collect({
					|name|
					(
						label: 			name,
						filterText: 	name,
						insertText:		"~%".format(name),
						insertTextFormat: 2, // Snippet,
						kind: 			2, // ??

						// @TODO Add documentation and detail
						// detail:			nil,
						// documentation: (
						// 	kind: 		"markdown",
						// 	value:		LSPDatabase.methodDocumentationString(method)
						// )
					)
				});

				if (results.notEmpty) {
					provideCompletionsFunc.(results, true);
				}
			}
		)
	}
}
