UnitTest2("classMethodHandler", {
	|test|
	var handler = LSPCompletionHandler.classMethodHandler;

	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	test.section("validatePrefix", {
		test.equals(
			handler.validatePrefix("IdentityDictionary", "."), Meta_IdentityDictionary,
			"Valid classname"
		);

		test.equals(
			handler.validatePrefix("    IdentityDictionary", "."), Meta_IdentityDictionary,
			"Valid classname with space"
		);

		test.equals(
			handler.validatePrefix("    IdentityFictionary", "."), nil,
			"Valid classname but not a class"
		);

		test.equals(
			handler.validatePrefix("    IdentityDictionary", "("), nil,
			"Invalid trigger"
		);

		test.equals(
			handler.validatePrefix("    lowercaseDictionary", "."), nil,
			"Invalid classname"
		);

		test.equals(
			handler.validatePrefix(" dictionary ", "."), nil,
			"Invalid classname"
		);
	});


	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	test.section("handle", {
		"asdf".warn;
		handler.handle(Meta_LSPCompletionHandler, ".", "addHan", {
			|result|

		"asdfadsfads".warn;
			result.postln;

			test.equals(
				result[\items].size,
				1,
				"Correct number of completions"
			);

			test.equals(
				result[\items][0][\filterText],
				"addHandler"
			);

			test.equals(
				result[\items][0][\labelDetails],
				(
					detail: "addHandler(name, trigger, prefixHandler, action)",
					description: "Meta_LSPCompletionHandler:addHandler"
				),
			);

			test.equals(
				result[\items][0][\label],
				"addHandler(name, trigger, prefixHandler, action)"
			)
		});

		handler.handle(Meta_LSPCompletionHandler, ".", "com", {
			|result|

			test.equals(
				result[\items].size,
				5,
				"Correct number of completions"
			);
		});
	})
}).runOrAdd();