#!/usr/bin/env node
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { APP_NAME } from "./config.js";
import { main } from "./main.js";

process.title = APP_NAME;
process.env.DS_CODING_AGENT = "true";
process.emitWarning = (() => {}) as typeof process.emitWarning;

setGlobalDispatcher(new EnvHttpProxyAgent({ bodyTimeout: 0, headersTimeout: 0 }));

main(process.argv.slice(2));
