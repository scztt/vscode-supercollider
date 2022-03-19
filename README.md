# SuperCollider Extension for VS Code

## Features
- Limited syntax highlighting
- Limited code completion, including:
  - Regular method completions like `foo.bar`
  - Class method completions like `Foo.bar`
  - Environment variable references like `~envir`
  - Names of def-style references like `Pdef(\foo` or `Ndef(\bar`
- Go to definition for classes and methods
- Execute selection, line, and region
- Decorations and notifications to show successful/failed execution

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

3. Install LanguageServer.quark
   
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
