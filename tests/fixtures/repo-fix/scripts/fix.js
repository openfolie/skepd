import { writeFileSync } from "node:fs";
writeFileSync("src/math.js", "export function add(a, b) {\n  return a + b;\n}\n");
