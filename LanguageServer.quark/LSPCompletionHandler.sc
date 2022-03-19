// Base class for handling code completion activities.
// Handlers are registered using `addHandler` - built-in handlers
// get registered automatically in `initClass`, but additional handlers
// can be added e.g. by Quarks.

LSPCompletionHandler {
	classvar <>completionHandlers;
	classvar <completionLimit = 30;

	var <>name, <>trigger, <>prefixHandler, <>action;

	// 'trigger' is one or more characters that can START this completion handler
	// 'prefixHandler' is a function that returns the parsed prefix (e.g. a class name) before the trigger.
	//   If there is no prefix handler, the handler is always processed. If the prefix handler returns nil,
	//   it is skipped.
	// 'action' is a function to process the prefix, where the arguments are: |doc, provideCompletions|
	*addHandler {
		|name, trigger, prefixHandler, action|
		completionHandlers = completionHandlers.add(this.prNew(name, trigger, prefixHandler, action))
	}

	*prNew {
		|name, trigger, prefixHandler, action|
		^super.newCopyArgs(name, trigger, prefixHandler, action)
	}

	*initClass {
		completionHandlers = completionHandlers.addAll([
			LSPCompletionHandler.classMethodHandler,
			LSPCompletionHandler.methodHandler,
			LSPCompletionHandler.environmentVariableHandler,
			// LSPCompletionHandler.singletonHandler,
			// LSPCompletionHandler.anonymousMethodHandler,
		]);
	}

	// Given a lineString like:
	//    prefix.completion
	// and a list of triggerCharacters:
	//    "."
	// return a list of [prefix, completionTrigger, completion] e.g.:
	//   [ "prefix", ".", "completion" ]
	*prGetCompletionString {
		|lineString, triggerCharacters|
		var prefix, completion, completionTrigger;
		var char = lineString.size - 1;

		while {
			(char >= 0) and: { triggerCharacters.includes(lineString[char]).not }} {
			char = char - 1;
		};

		if (char >= 0) {
			completion = lineString[char+1..].stripWhiteSpace;
			completionTrigger = lineString[char];
			prefix = lineString[..char-1].findRegexp("([~\\w]*\\(?)$".format(
				triggerCharacters.escapeChar($().escapeChar($\\)
			));
			if (prefix.notEmpty) {
				prefix = prefix[1][1]
			} {
				prefix = nil
			};

			^[prefix, completionTrigger.asString, completion]
		} {
			^[nil, nil, nil]
		}

	}

	// For a given handler, return true if trigger matches the handler's trigger
	// AND the handler.validatePrefix returns a non-nil result (meaning: it
	// recognised the prefix as something it can do a completion on).
	*prValidateHandler {
		|handler, prefix, trigger, completion|
		var validatedPrefix;

		^(
			(handler.trigger == trigger)
			and: {
				(validatedPrefix = handler.validatePrefix(prefix)).notNil
			}
		)
	}

	*handleCompletion {
		|lineString, triggerCharacters|
		var prefix, trigger, completion;
		var validatedPrefix, handler;

		triggerCharacters = triggerCharacters ?? { "(." };

		// prefix: 		all text before the trigger
		// trigger: 	one character that triggered the completion
		// completion:	the remaining characters to do completion on
		#prefix, trigger, completion = this.prGetCompletionString(
			lineString,
			triggerCharacters
		);

		Log(LSPCompletionHandler).info("Doing completion on: % / % / %", prefix, trigger, completion);

		// Find the first handler for which prValidateHandler returns non-nil.
		handler = completionHandlers.detect({
			|handler|
			(validatedPrefix = handler.validatePrefix(prefix, trigger)).postln.notNil
		});

		if (handler.notNil) {
			Log(LSPCompletionHandler).info("Using handler: %", handler.name);
			^handler.handle(validatedPrefix, trigger, completion);
		} {
			Log(LSPCompletionHandler).info("No handler for completion: % / % / %", prefix, trigger, completion);
			^nil
		}
	}

	validatePrefix {
		|prefix, validateTrigger|
		var reResult;

		Log(LSPCompletionHandler).info("validatePrefix, triggers: (% != %) = %", trigger, validateTrigger, trigger != validateTrigger);

		if (trigger != validateTrigger) { ^nil };

		^if (prefixHandler.isString) {
			reResult = prefix.findRegexp(prefixHandler);
			if (reResult.notEmpty) {
				reResult[1][1]
			} {
				nil
			}
		} {
			prefixHandler.value(prefix)
		}
	}

	handle {
		|prefix, trigger, completion|
		var deferredResult = Deferred();

		action.value(
			prefix, trigger, completion,
			{
				|completions, isIncomplete=true|
				deferredResult.value = (
					isIncomplete: isIncomplete,
					items: completions
				)
			}
		);

		^deferredResult;
	}
}
