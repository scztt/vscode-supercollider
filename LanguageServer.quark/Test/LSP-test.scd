
UnitTest2({
	|test|
	var method, handler, prefixCalled, actionCalled, mockMessage;

	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	test.section("LSPDatabase", {

		method = LSPCompletionHandler.methods.detect({ |m| m.name == \validatePrefix });

		test.equals(
			LSPDatabase.methodDetails(method),
			(
				detail: "validatePrefix(prefix, validateTrigger)",
				description: "LSPCompletionHandler:validatePrefix"
			)
		);

		test.equals(
			LSPDatabase.methodArgString(method),
			"validatePrefix(prefix, validateTrigger)"
		);

		test.equals(
			LSPDatabase.methodInsertString(method),
			"validatePrefix(${1:prefix}, ${2:validateTrigger}${0})"
		);

		test.equals(
			LSPDatabase.methodArgString(method),
			"validatePrefix(prefix, validateTrigger)"
		);
	});

	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	test.section("LSPCompletionHandler:prGetCompletionString", {

		test.equals(
			LSPCompletionHandler.prGetCompletionString("  complete/something", "/"),
			["complete", "/", "something"]
		);

	});


	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	test.section("Custom handler", {

		actionCalled = prefixCalled = false;

		LSPCompletionHandler.completionHandlers.clear;

		LSPCompletionHandler.addHandler(
			name: "mockHandler",
			trigger: "?",
			prefixHandler: {
				|prefix|
				prefixCalled = true;
				test.equals(prefix, "prefix");
				"validated prefix"
			},
			action: {
				|prefix, trigger, completion, provideCompletionsFunc|
				actionCalled = true;

				test.equals(prefix, "validated prefix");
				test.equals(trigger, "?");
				test.equals(completion, "completion");

				provideCompletionsFunc.value([(mock: true)])
			}
		);

		LSPCompletionHandler.handleCompletion("prefix?completion", "?", {
			|result|
			"~~~~~~~~~~~~~~~~~~~~~~~~~~~~".postln;
			test.assert(result[\items].size == 1, "Completion results returned");
		});

		test.assert(prefixCalled, "prefix handler called");
		test.assert(actionCalled, "action called");
	});


}).runOrAdd