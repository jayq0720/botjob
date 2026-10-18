/** stdio MCP framing owns stdout. These console methods must not write there. */
export {};
const toStderr = console.error.bind(console);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
console.dir = toStderr as typeof console.dir;
console.table = toStderr as typeof console.table;
console.trace = toStderr as typeof console.trace;
