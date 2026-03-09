# SuperCollider Extension for VS Code

## Features

- Syntax highlighting for `.sc`, `.scd`, and `.schelp` files
- Code completion:
  - Method completions (`foo.bar`, `Foo.bar`)
  - ~environment variables
  - Def-style name completions (`Pdef(\foo)`, `Ndef(\bar)`)
  - Argument hints for method calls and constructors
- Code hover shows Class / Method description and signature
- Go-to-definition for classes and methods
- Evaluate selection, line, and region with visual feedback (color-coded success/error decorations)
- Fast evaluation of named code regions ("Evaluate region by name" command)
- Server status bar with real-time CPU, UGen, Synth, and Group counts
- Per-workspace sclang instances with independent server ports
- Drag-and-drop file path insertion
- Optional code formatting via `sclang-format`

# How to Install

1. Download SuperCollider **3.14.0 or later**.
    https://supercollider.github.io/downloads

2. Download the `.vsix` file from the latest release:
    https://github.com/scztt/vscode-supercollider/releases

3. Install the extension in VSCode (from the command palette: "Extensions: Install from VSIX..."). Restart VSCode or "Developer: Reload window".
 
4. Install the LanguageServer.quark - from the VSCode command palette, choose "SuperCollider: Update LanguageServer.quark" - or run `Quarks.install("https://github.com/scztt/LanguageServer.quark")` from the legacy SC IDE.

5. For common install scenarios on Windows and Mac, vscode will automatically find the sclang executable. You may be prompted on first launch to locate it yourself. The path to the sclang executable can be set using the `Supercollider > Sclang: Cmd` setting.

# Usage

The extension will activate when you open a workspace with `.sc` or `.scd` files. A unique sclang executable process will be launched for each workspace. The output from sclang is visible in the "Output" panel, under the "SuperCollider" drop-down.

Code can be evaluated using the "Evaluate Region" / "Evaluate Line" commands, using the normal Command / Ctrl / Shift + Enter shortcuts. These can be reconfigured with the gear icon next to the commands in the VSCode palette.

The VSCode extension will use your global startup.scd file and sclang_conf.yaml file by default, but can be configured to use workspace-local sclang_conf.yaml and startup.scd files - this makes it easy to maintain different quark or startup configurations per-project.

## Code blocks and evaluation

Code blocks in SuperCollider are represented by open- and closed-parens on a line by themselves. In VSCode, code blocks will show up as regions - adding a commend to the open-paren line will name the region in VSCode:
```
( // SYNTHDEFS
)
```

Use Cmd+Shift+O to fast-navigate between code blocks.

The "Evaluate Regions By Name" command will show a list of all code blocks in the current file.
Single or multiple code blocks can be selected and evaluated. This does not affect cursor or scroll position, so it can easily be used to evaluate code blocks that are not visible, or to evaluate a sequence of code blocks without doing the "Cmd+Enter" dance.

## Workspace management

Workspace specific startup and sclang_conf.yaml files can be enabled in Settings. Local and/or global startup files will be run on sclang launch depending on settings - global is always run first.

Local startup files allow for project-specific startup code - this is helpful for server settings,  pre-loading audio files or SynthDefs. 

Local sclang_conf.yaml files allow for project-specific quark and classpath settings. This is helpful for managing dependencies on a per-project basis.

## Environment / "Xdef" visibility

The language server is aware of environment variables, as well as "XDef" style globlal registries like `Ndef`, `OSCdef`, `Pdef`, etc. It will show hover info for these values, and should auto-complete to known definitions.

The `isDefClass` and `prGetNames` methods on a given class determine if it shows up as a "global registry" class. Providing these methods for a new class allows it to provide auto-completion and hover into for its registered values (see existing definitions of `prGetNames`).

## Experimental Features

*These features are experimental — they are unstable, and may or may not ever reach release quality.*

### In-Editor Help System

Browse SuperCollider class and method documentation directly inside VS Code. A local help server renders `.schelp` files in a webview panel that matches your editor theme. Use the **"SuperCollider: Search Help"** command to look up any class or topic

### Control Panel

A sidebar panel (in the SuperCollider activity bar) that displays interactive controls exposed by your SuperCollider code. Supports numeric sliders, buttons, popup menus, and hierarchical grouping. Useful for live-tweaking synth parameters without writing code. See "Control Panel Example.scd" example in the LanguageServer quark.

### sclang Info Panel

A sidebar panel showing the current state of the sclang process: running/stopped status, sclang version, binary path, command-line arguments, startup files, and `sclang_conf.yaml` include/exclude paths. Helpful for diagnosing configuration issues.

### LiveShare Coop Mode

Allows VS Code LiveShare guests to evaluate SuperCollider code on the host machine in real time. In this mode, code evaluation from all LiveShare participants is sent to the host sclang process. This enables several users editing, evaluating code, and playing sound on a single machine remotely. **IMPORTANT: This allows LiveShare participants to execute arbitrary code on your machine. Invite only trusted collaborators!**. Enable this feature with the `supercollider.enableLiveShareCoop` setting. 
To see users names and improve functionality, create a file at `~/.vs-liveshare-settings.json` that contains this:
```
{
    "extensionPermissions": {
        "ScottCarver.vscode-supercollider": [
            "shareServices",
            "readUserProfile"
        ]
    }
}
```

Then:
- When you start hosting a LiveShare session, you will be asked to enable Co-op mode. Choosing "No" here will start a regular non-Co-op session, where guests cannot execute code.
- When users join your LiveShare session, they will be asked if they want to enable Co-op mode. If they choose "Yes", SuperCollider actions will be re-routed to your VSCode instance. Behavior for the will appear identical to a normal VSCode SC session, though they will not e.g. hear sound.


### MCP Server

An [MCP](https://modelcontextprotocol.io/) server that exposes SuperCollider to AI tools like Claude. Provides tools for evaluating code, browsing help documentation, inspecting the server node tree, and controlling the audio server. MCP's are unique per-workspace, as they allow a Claude instance to interact directly with a specific sclang instance.

To enable:
- Enable `supercollider.mcp.enabled` setting
- When setting up MCP for a workspace for the first time, run **"SuperCollider: Start MCP Server"** command.

This will create an `.mcp.json` settings file in the workspace, that directs LLM's like Claude to your local MCP server. You may need to reload the window on the first attempt. Currently, the MCP server provides:
- code evaluation
- class / method lookup
- help documentation lookup
- server boot / node tree inspection

In particular, the MCP's code evaluation has trouble with async operations, but usually Claude etc can work around by reading the post window.

# Development

## How to get started

1. Clone repository:

    ```
    git clone --recursive https://github.com/scztt/vscode-supercollider.git
    cd vscode-supercollider
    ```
2. Install npm dependencies:

    ```
    npm install
    ```

3. Install LanguageServer.quark:

    ```supercollider
    // (in SuperCollider...)
    Quarks.install("https://github.com/scztt/LanguageServer.quark")
    ```

## How to run

1. Open the `vscode-supercollider` folder in VSCode.
2. Before first launch / when changing `.ts` files: `Run: Build Task -> tsc:build`
3. To launch a debug environment: `Debug: Start Debugging`
4. On first launch of the debug environment:
   - Configure the extension settings in `Preferences: Open Settings (UI)`, search for SuperCollider
   - sclang path is required; sclang_conf path is optional

# Bugs / Feature requests

Please report bugs or feature requests on the GitHub issues page:
https://github.com/scztt/vscode-supercollider

