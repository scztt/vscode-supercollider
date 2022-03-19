// LSPDatabase is a container for pure functions that return metadata about open documents or
// sclang instance details like lists of classes. Functions are expected to be called inside of
// a Routine and should yield during long operations. These should be considered good candidates
// for caching.

LSPDatabase {
	classvar allMethodNames, allMethods, allMethodsByName, methodLocations;

	*initClass {
		methodLocations = ();
	}

	*methodSortFunc {
		^{
			|a, b|
			if (a.name < b.name) {
				true
			} {
				if (a.name > b.name) {
					false
				} {
					a.ownerClass.name < b.ownerClass.name
				}
			}
		}
	}

	*rangeForItems {
		|list, function, newObjectA, newObjectB|
		var a, b;
		a = this.indexForItem(list, function, newObjectA);
		b = this.indexForItem(list, function, newObjectB, a);
		^Range(a, b-a-1);
	}

	*indexForItem {
		|list, function, newObject, low=0|

		var index;
		var high = list.size-1;

		while ({
			index = high + low div: 2;
			low <= high;
		}, {
			if (function.value(list.at(index), newObject), {
				low = index + 1;
			},{
				high = index - 1;
			});
		});

		^low
	}

	*uniqueMethodsForClass {
		|class|
		var methods = class.methods;
		methods = Array.newFrom(methods).sort({
			|a, b|
			a.name < b.name
		});
		^methods;
	}

	*methodsForClass {
		|class|
		var result, methodNames = IdentitySet(), methods = [];

		(class.superclasses.reverse ++ [class]).reverse.do {
			|class|
			this.uniqueMethodsForClass(class).do {
				|method|
				if (methodNames.includes(method.name).not) {
					methodNames.add(method.name);
					methods = methods.add(method);
				}
			}
		};

		^[
			methods.collect(_.name),
			methods
		]
	}

	*allMethodNames {
		if (allMethodNames.notNil) { ^allMethodNames };

		allMethodNames = this.allMethods.collect(_.name);
		allMethodNames.freeze;

		^allMethodNames;
	}

	*allMethods {
		if (allMethods.notNil) { ^allMethods };

		Class.allClasses.do {
			|class|
			allMethods = allMethods.addAll(LSPDatabase.uniqueMethodsForClass(class));
		};

		allMethods = allMethods.sort(this.methodSortFunc);
		allMethods.freeze;

		^allMethods
	}

	*allMethodsByName {
		if (allMethodsByName.notNil) { ^allMethodsByName };

		allMethodsByName = ();
		this.allMethods.do {
			|method|
			allMethodsByName[method.name] = allMethodsByName[method.name].add(method);
		};

		^allMethodsByName;
	}

	*matchMethods {
		|startsWith|
		var range, allMethodNames, endString;

		allMethodNames = this.allMethodNames;

		if (startsWith.size == 0) {
			^Range(0, allMethodNames.size)
		};

		endString = startsWith.copy;
		endString[endString.size-1] = (endString[endString.size-1].asUnicode + 1).asAscii;

		range = this.rangeForItems(
			allMethodNames, { |a, b| a < b },
			startsWith.asSymbol, endString.asSymbol
		);

		^range
	}

	*methodsForName {
		|methodName|
		^this.allMethodsByName[methodName.asSymbol]
	}

	*methodArgString {
		|method|
		^"%(%)".format(
			method.name,
			(method.argNames !? _[1..] ?? []).join(", ")
		)
	}

	*methodInsertString {
		|method|
		^"%(%${0})".format(
			method.name,
			(method.argNames !? _[1..] ?? []).collect({
				|a, i|
				"${%:%}".format(i+1, a)
			}).join(", ")
		)
	}

	*methodDocumentationString {
		|method|
	}

	*findDefinitions {
		|word|
		var methods;

		if (word.isClassName) {
			^[this.makeClassDefinition(word.asClass)]
		} {
			methods = this.methodsForName(word);

			^methods.collect {
				|method|
				this.makeMethodDefinition(method)
			}
		}
	}

	*makeMethodRange {
		|method|
		var file = File(method.filenameSymbol.asString, "r");
		var methodFileSource = file.readAllString();
		var lineChar = methodFileSource.charToLineChar(method.charPos);

		file.close();

		^(
			start: (
				line: lineChar[0],
				character: lineChar[1]
			),
			end: (
				line: lineChar[0],
				character: lineChar[1]
			)
		)
	}

	*makeClassRange {
		|class|
		// Lucky us, these implementations are identical for now.
		^this.makeMethodRange(class)
	}

	*makeMethodDefinition {
		|method|
		^(
			uri: "file://%".format(method.filenameSymbol),
			range: this.makeMethodRange(method)
		)
	}

	*makeClassDefinition {
		|class|
		^(
			uri: "file://%".format(class.filenameSymbol),
			range: this.makeClassRange(class)
		)
	}

	*makeMethodCompletion {
		|method|
		var sortText;

		if (method.ownerClass.isMetaClass) {
			sortText = (9 - method.ownerClass.superclasses.size).asString.zeroPad()
		} {
			sortText = "%:%".format(method.ownerClass.name, method.name)
		};

		^(
			label: 			"% [%]".format(LSPDatabase.methodArgString(method), method.ownerClass.name),

			filterText: 	method.name.asString,
			sortText:		sortText,
			insertText:		LSPDatabase.methodInsertString(method),
			insertTextFormat: 2, // Snippet,

			labelDetails:	LSPDatabase.methodDetails(method),
			kind: 			2, // ??

			// @TODO Add documentation and detail
			// detail:			nil,
			// documentation: (
			// 	kind: 		"markdown",
			// 	value:		LSPDatabase.methodDocumentationString(method)
			// )
		)
	}

	*methodDetails {
		|method|
		^(
			detail: this.methodArgString(method),
			description: "%:%".format(method.ownerClass.name, method.name)
		)
	}

	*getDocumentLine {
		|doc, line|
		^doc.getLine(line)
	}

	*getDocumentWordAt {
		|doc, line, character|
		var lineString = this.getDocumentLine(doc, line);
		var start = character;
		var word;

		Log(LSPDatabase).info("Searching line for a word: '%' at %:%", lineString, line, character);

		while {
			(start >= 0) and: { (lineString[start].isAlphaNum or: { lineString[start] == $_ }) }
		} {
			start = start - 1
		};
		start = start + 1;

		word = lineString.findRegexpAt("[A-Za-z][\\w]*", start);
		if (word.size > 0) {
			^word[0]
		} {
			^nil
		}
	}
}

+String {
	charToLineChar {
		|absoluteChar|
		var char = 0, line = 0, lineStartChar = 0;
		absoluteChar = min(absoluteChar, this.size);

		while { char < absoluteChar } {
			if (this[char] == Char.nl) {
				lineStartChar = char + 1;
				line = line + 1
			};
			char = char + 1
		};

		^[line, char - lineStartChar]
	}
}