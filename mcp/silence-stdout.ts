/** stdio MCP framing owns stdout. Libraries that log must not write there. */
console.log = (...args: unknown[]) => {
  console.error(...args);
};
