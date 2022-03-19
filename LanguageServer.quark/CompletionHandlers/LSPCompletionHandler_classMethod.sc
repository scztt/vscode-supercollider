// Handle completions where the prefix looks like a class name, e.g.:
//   Class.metho
+LSPCompletionHandler {
	*classMethodHandler {
		^LSPCompletionHandler.prNew(
			name: "method_class",
			trigger: ".",
			prefixHandler: {
				|prefix|
				var prefixClass;

				// @TODO: Improve regex/parsing to detect all class method like cases....
				prefixClass = prefix.findRegexp("^[^\\w]*([A-Z][A-Za-z0-9_]*)");

				if (prefixClass.notEmpty) {
					prefixClass = prefixClass[1][1];

					if ((prefixClass = prefixClass.asSymbol.asClass).notNil) {
						prefixClass.class
					} {
						nil
					}
				} {
					nil
				}
			},
			action: {
				|prefixClass, trigger, completion, provideCompletionsFunc|
				var firstMatch, lastMatch, matches, names;
				var results, methodNames, methods, method;

				// Subtle: We simply return all methods for a class - the list should be
				// short-ish and we can cache our response for future uses if needed.
				#methodNames, methods = LSPDatabase.methodsForClass(prefixClass);

				Log(LSPCompletionHandler).info("Found % method completions", methods.size);

				// @TODO Remove once we fix RPC content-size stuff - without this, we often
				// have too many methods and our response will fail.
				methods = methods[0..100];

				// @TODO Fetch results via a single method in LSPDatabase, so we can
				// cache the entire response data rather than iterating here?
				results = methods.collect(LSPDatabase.makeMethodCompletion(_));

				provideCompletionsFunc.value(results, false);
			}
		)
	}
}
