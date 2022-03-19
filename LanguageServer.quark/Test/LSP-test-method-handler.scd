Log(LSPCompletionHandler).level = \debug;
UnitTest2("methodHandler", {
	|test|
	var handler = LSPCompletionHandler.methodHandler;

	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	test.section("validatePrefix", {
		test.equals(
			handler.validatePrefix("variable", "."), "variable",
			"Valid variable name"
		);

		test.equals(
			handler.validatePrefix("   variable", "."), "variable",
			"Valid variable name"
		);

		test.equals(
			handler.validatePrefix("   ~variable", "."), "~variable",
			"Valid env variable name"
		);

		test.equals(
			handler.validatePrefix("    1234", "."), "1234",
			"Integer"
		);

		test.equals(
			handler.validatePrefix("    1.0", "."), "1.0",
			"Float"
		);

		test.equals(
			handler.validatePrefix("    Dictionary", "."), nil,
			"Looks like a class name"
		);

		test.equals(
			handler.validatePrefix("    ", "."), nil,
			"Empty"
		);

		test.equals(
			handler.validatePrefix("    variable.", "."), nil,
			"Double dot"
		);

	});

	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	test.section("handle", {

		handler.handle("variable", ".", "prHandle", {
			|result|
			var prHandleMessageDescription;

			test.equals(
				result[\items].size,  4
			);

			prHandleMessageDescription = result[\items].detect({
				|item|
				item[\filterText] == "prHandleMessage";
			});

			test.notNil(prHandleMessageDescription);

			test.equals(
				prHandleMessageDescription[\labelDetails],
				(
					detail: "prHandleMessage(object)",
					description: "LSPConnection:prHandleMessage"
				),
			);

			test.equals(
				prHandleMessageDescription[\label],
				"prHandleMessage(object)"
			)
		});

		handler.handle(Meta_LSPCompletionHandler, ".", "com", {
			|result|

			test.equals(
				result[\items].size,
				104,
				"Correct number of completions"
			);
		});
	})
}).runOrAdd();