# SuperCollider Extension for VS Code

## Features
- Limited syntax highlighting
- Limited code completion, including:
  - Regular method completions like `foo.bar`
  - Class method completions like `Foo.bar`
  - ~~Environment variable references like `~envir`~~ (broken right now)
  - Names of def-style references like `Pdef(\foo` or `Ndef(\bar`
  - Argument hints for method calls and constructors
- Go-todefinition for classes and methods
- Evaluate selection, line, and region
- Decorations and notifications to show successful/failed execution

# How to Install

1. Download a **current develop build** of SuperCollider (the extension requires recent changes you may not have)
    https://supercollider.s3.amazonaws.com/builds/supercollider/supercollider/osx/develop-latest.html
    https://supercollider.s3.amazonaws.com/builds/supercollider/supercollider/win32/develop-latest.html
    https://supercollider.s3.amazonaws.com/builds/supercollider/supercollider/win64/develop-latest.html

2. Download the .vsix file from the latest release:
    https://github.com/scztt/vscode-supercollider/releases

3. Install the extension in vscode (from the command palette: "Extensions: Install from VSIX...")

4. In your user settings (from the command palette: "Preferences: Open User Settings"), search for SuperCollider.
   Set the following settings:
   
    **Supercollider › Sclang: Cmd** 
   
   The path to your sclang executable (e.g. `/Applications/SuperCollider.app/Contents/MacOS/sclang` on mac or `C:\Program Files\SuperCollider\sclang.exe` on windows)

   **Supercollider › Sclang: Conf Yaml** 
   
   The path to your conf.yaml file - you can find this in the current SuperCollider IDE in Preferences -> Interpreter -> Active Config File. You can also create an empty `.yaml` in a location of your choiuce and point to that.

5. Install the LanguageServer.quark in SuperCollider (from the command palette: "SuperCollider: Update LanguageServer.quark")

6. Open a project folder containing .scd or .sc files! Most existing IDE commands are available in VSCode, you can find them by searching for "SuperCollider" from the command palette. Some are already mapped to the expecte keyboard shortcuts (e.g. Cmd+Enter and Cmd+Period), some are not (you can use the gear icon next to the command to set keyboard shortcuts).

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

3. Build or download the supercollider `topic/refactor-com-port` branch:
   
    CI builds: https://github.com/supercollider/supercollider/actions?query=branch%3Atopic%2Frefactor-com-port++ (click the most recent green build, scroll to "Artifacts" to find the builds)

    https://github.com/supercollider/supercollider/tree/topic/refactor-com-port

4. Install LanguageServer.quark
   
    ```
    // (in SuperCollider...)
    Quarks.install("/path/to/vscode-supercollider/LanaguageServer.quark")
    ```

## How to run

1. Open `vscode-supercollider` folder in vscode.
2. Before first launch / when changing .ts files: `Run: Build Task -> tsc:build`
3. To launch a debug environment, `Debug: Start Debugging`.
4. On first launch of the debug environment:
   - Configure the extension settings in `Preferences: Open Settings (UI)`, search for SuperCollider
   - sclang path and sclang_conf path are required settings - these can be found in the ScIDE Preferences dialog

# Usage

- One `sclang` process will launch per workspace, any time an `.sc` / `.scd` file is opened.
- Process output can be viewed in Output window, by selecting "supercollider"
- Several commands are defined for SuperCollider contexts - these are visible in the command palette (Cmd+P) by searching for SuperCollider. Remember that you can set keyboard shortcut commands for these to replicate the ScIDE experience.

# Bugs / Feature requests

Please report bugs or feature requests on the GitHub issues page for the extension:
https://github.com/scztt/vscode-supercollider
