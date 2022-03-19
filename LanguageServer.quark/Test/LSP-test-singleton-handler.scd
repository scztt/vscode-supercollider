/*
UnitTestScript("LSP", thisProcess.nowExecutingPath).runScript;
*/

UnitTest2("singletonHandler", {
	|test|
	var method, handler, prefixCalled, actionCalled, mockMessage;

	handler = LSPCompletionHandler.singletonHandler;

	////////////////////////////////////////////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////////////////////////////////////////////
	test.section("validatePrefix", {
		test.equals(
			handler.validatePrefix("    Ndef", "("), Ndef,
			"Valid classname"
		);

		test.equals(
			handler.validatePrefix("    Dictionary", "("), nil,
			"Valid classname but not a singleton"
		);

		test.equals(
			handler.validatePrefix("    Ndef", "."), nil,
			"Invalid trigger"
		);

		test.equals(
			handler.validatePrefix("    lowercaseNdef", "("), nil,
			"Invalid classname"
		);
	});

	////////////////////////////////////////////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////////////////////////////////////////////
	test.section("handle", {
		test.section("Pdef", {

			Pdef(\__unit_testing,  	Pbind());
			Pdef(\__unit_testing_2, Pbind());
			Pdef(\__unmatched_name, Pbind());

			// Pdef(\__uni)
			handler.handle(Pdef, "(", "\\__uni", {
				|result|

				test.equals(
					result[\items].size,
					2,
					"Correct number of completions"
				);

				test.equals(
					result[\items][0][\filterText],
					"\\__unit_testing"
				);

				test.equals(
					result[\items][1][\filterText],
					"\\__unit_testing_2"
				);

				test.equals(
					result[\items][1][\labelDetails],
					(
						detail: "Pdef(\\__unit_testing_2)"
					),
				);

				test.equals(
					result[\items][1][\label],
					"\\__unit_testing_2"
				)
			});

		});

		test.section("Pbind", {
			Ndef(\__unit_testing,  	Pbind());
			Ndef(\__unit_testing_2, Pbind());
			Ndef(\__unmatched_name, Pbind());

			// Ndef(\__uni)
			handler.handle(Ndef, "(", "\\__uni", {
				|result|

				test.equals(
					result[\items].size,
					2,
					"Correct number of completions"
				);
			});

		})


	})
}).runOrAdd();