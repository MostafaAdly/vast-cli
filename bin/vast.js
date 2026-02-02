#!/usr/bin/env node

/**
 * Vast CLI - Entry point
 * 
 * This is the main entry point for the vast command-line tool.
 * It bootstraps the CLI and registers all available commands.
 */

import { VastCli } from '../dist/cli.js';

// Initialize and run the CLI
const cli = new VastCli();
cli.run();
