#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const server = createServer();
await server.connect(new StdioServerTransport());
// stdout carries the MCP protocol, so diagnostics go to stderr.
console.error(`${SERVER_NAME} ${SERVER_VERSION} running on stdio`);
