#!/usr/bin/env node
import { register } from "tsx/esm/api";

for (const name of ["log", "info", "debug", "dir", "table", "trace"]) {
  console[name] = console.error.bind(console);
}

register();
await import(new URL("../mcp/stdio.ts", import.meta.url).href);
