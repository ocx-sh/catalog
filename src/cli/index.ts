#!/usr/bin/env node
import { main } from "./main.js";
import { FAIL } from "./exit.js";

try {
  await main();
} catch (err) {
  console.error(err);
  process.exitCode = FAIL;
}
