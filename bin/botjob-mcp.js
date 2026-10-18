#!/usr/bin/env node
import { register } from "tsx/esm/api";

console.log = (...args) => {
  console.error(...args);
};

register();
await import(new URL("../mcp/stdio.ts", import.meta.url).href);
