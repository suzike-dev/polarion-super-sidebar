# Source attribution

SOAP adapter source copied from the user's installed `suzike-dev/polarion-mcp-server` v1.9.0 on 2026-11-03 under its MIT license (adjacent LICENSE). The installed MCP and its configuration are unchanged. This owned copy is bundled into the credential-only child worker. Product save gates, draft versions and readback are implemented in `apps/host/polarion.ts`; the upstream adapter's pre-read timestamp check is not an atomic server compare-and-swap.
