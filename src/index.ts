import { buildCli } from "./cli/cli.js";
const program = buildCli();
program.parseAsync(process.argv).catch((e) => { console.error(e); process.exit(1); });