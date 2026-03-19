
SuperCollider MCP Server
========================

This extension can run an MCP (Model Context Protocol) server,
allowing Claude (or any MCP client) to evaluate SuperCollider code
and control the audio server directly.

--- Setup ---

1. Enable the MCP server in VSCode settings:

    "supercollider.mcp.enabled": true
    "supercollider.mcp.port": 22123    // optional, this is the default

2. Restart the extension (or reload the VSCode window).

3. Configure your MCP client to connect:

--- Claude Code (.mcp.json) ---

Add to your project's .mcp.json or ~/.claude/.mcp.json:

{
    "mcpServers": {
        "supercollider": {
            "type": "sse",
            "url": "http://localhost:22123/sse"
        }
    }
}

--- Claude Desktop (claude_desktop_config.json) ---

macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
Windows: %APPDATA%\Claude\claude_desktop_config.json

{
    "mcpServers": {
        "supercollider": {
            "type": "sse",
            "url": "http://localhost:22123/sse"
        }
    }
}

--- Available Tools ---

evaluate
    Evaluate a SuperCollider code string and return the result.
    Parameters: code (string)

    Example: { "code": "1 + 1" }  =>  "2"

evaluate_file
    Evaluate code from a file at a specific line range.
    Parameters: filePath (string), startLine (int), endLine (int)
    Lines are 1-indexed and inclusive.

    Example: { "filePath": "/path/to/file.scd", "startLine": 10, "endLine": 20 }

get_post_window
    Get recent output from the SuperCollider post window.
    Parameters: lines (int, default 50, max 200)

cmd_period
    Stop all running sounds and scheduled tasks (Cmd+Period).
    No parameters.

boot_server
    Boot the default SuperCollider audio server.
    No parameters.

reboot_server
    Reboot the default SuperCollider audio server.
    No parameters.

kill_all_servers
    Kill all running SuperCollider audio servers.
    No parameters.

--- Notes ---

- The MCP server starts when the extension activates (if enabled)
    and runs for the lifetime of the VSCode window.
- The server listens on localhost only.
- Evaluation results include compile errors and runtime errors
    when they occur.
- The post window buffer keeps the most recent 200 lines.
