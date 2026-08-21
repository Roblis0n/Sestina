#!/usr/bin/env node
import { runPilotCli } from "./cli.js";

process.exitCode = await runPilotCli(process.argv.slice(2));
