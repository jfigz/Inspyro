"""Inspyro MCP Server - __main__ entry point.

Permite ejecutar el servidor MCP como modulo:
    python -m mcp_server
    python -m mcp_server --stdio
"""

from .start_mcp import main

if __name__ == "__main__":
    main()