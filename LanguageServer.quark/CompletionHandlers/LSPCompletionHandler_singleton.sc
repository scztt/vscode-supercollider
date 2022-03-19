// Handle completions where the prefix looks like an sclang Singleton / global object, e.g.:
//   Ndef(\name)
//   Pdef(\name)
//   MIDIdef(\name)

+LSPCompletionHandler {
	*singletonHandler {
		^LSPCompletionHandler.prNew(
			name: "singleton",
			trigger: "(",
			prefixHandler: {
				|prefix|
				var prefixClass = prefix.findRegexp("[^\\w-]([A-Z]\\w*)$");

				^if (prefixClass.notEmpty) {
					prefixClass = prefixClass[1][1];
					if ((prefixClass = prefixClass.asSymbol.asClass).notNil and: {
						prefixClass.isDefClass
					}) {
						prefixClass
					} {
						nil
					}
				} {
					nil
				}
			},
			action: {
				|prefixClass, trigger, completion, provideCompletionsFunc|
				var results, defNames;

				defNames = prefixClass.prGetNames.asArray.sort;
				defNames = defNames.collect({ |name| "\\" ++ name.asString });

				Log(LSPCompletionHandler).info("Starting with defs: %", defNames);

				defNames = defNames.select({
					|name|
					name.asString.beginsWith(completion)
				});

				Log(LSPCompletionHandler).info("Filtered based on % to: %", completion, defNames);

				results = defNames.collectAs({
					|name|
					(
						label: 			name,
						filterText: 	name,
						insertText:		name,
						insertTextFormat: 2, // Snippet,
						labelDetails:	(
							detail: "%(%)".format(prefixClass.name, name),
						),
						kind: 			2, // ??

						// @TODO Add documentation and detail
						// detail:			nil,
						// documentation: (
						// 	kind: 		"markdown",
						// 	value:		LSPDatabase.methodDocumentationString(method)
						// )
					)
				}, Array);

				provideCompletionsFunc.value(results, true);
			}
		)
	}
}

+Object  {
	*isDefClass { ^false }
	*prGetNames { ^this.all.keys } // this is valid for MOST def classes....
}

+Ndef {
	*isDefClass { ^true }
	*prGetNames { ^this.all[Server.default.name].keys } // @TODO Search across all servers here?
}

+NdefPreset { *isDefClass { ^true } }
+Pdef { *isDefClass { ^true } }
+PdefPreset { *isDefClass { ^true } }
+Tdef { *isDefClass { ^true } }
+TdefPreset  { *isDefClass { ^true } }
+Fdef { *isDefClass { ^true } }
+HIDdef { *isDefClass { ^true } }
+MIDIdef { *isDefClass { ^true } }
+OSCdef { *isDefClass { ^true } }
