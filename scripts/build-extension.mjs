import { build } from 'esbuild';
await build({ entryPoints: ['bot/lib/boards/extension-dom.ts'], outfile: 'extension/page.js', bundle: true, format: 'iife', globalName: 'BotjobPage', target: 'chrome120' });
console.log('extension/page.js built');
