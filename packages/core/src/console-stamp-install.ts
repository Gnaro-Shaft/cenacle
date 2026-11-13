/**
 * Loaded first by every program run by launchd (deploy/launchd/run.sh puts
 * it in NODE_OPTIONS): dated log lines, a crash in one line. See console-stamp.ts.
 */
import { installConsoleStamp } from "./console-stamp.ts";

installConsoleStamp(console, process);
