# Vast CLI

CLI toolkit for managing Vast-menu GitHub workflows and operations.

## Installation

```bash
cd ~/Workshop/Work/vast-cli
npm install
npm run build
```

### Global Alias (Recommended)

Add to your `~/.zshrc` or `~/.bashrc`:

```bash
alias vast='node ~/Workshop/Work/vast-cli/bin/vast.js'
```

Then reload your shell:
```bash
source ~/.zshrc  # or ~/.bashrc
```

## Usage

### Workflow Command

Run GitHub Actions workflows for Vast-menu repositories.

```bash
# Trigger workflow for staging
vast workflow Vast-menu-payments --target-version 999.0.0-test --branch staging

# List available workflows
vast workflow VastmenuPwa --list

# Dry run to validate parameters
vast workflow Vastmenu-Dashboard --target-version 1.2.3 --branch production --dry-run

# With watch mode (coming soon)
vast workflow Vastmenu-Backend --target-version 2.0.0 --branch main --watch
```

### Available Repositories

- VastmenuPwa
- VastmenuPwaV2
- Vastmenu-Dashboard
- Vastmenu-Backend
- VastpayPwa
- Vastpay-Dashboard
- Vastpay-Backend
- Vast-menu-payments

### Options

| Flag | Description |
|------|-------------|
| `-v, --version` | Version to deploy (e.g., 1.2.3) |
| `-b, --branch` | Target branch (e.g., staging, production) |
| `-l, --list` | List available workflows |
| `-n, --dry-run` | Validate without triggering |
| `--verbose` | Show detailed output |
| `--watch` | Watch workflow run (WIP) |
| `-a, --approve` | Auto-merge the resulting PR |
| `-i, --inputs <pairs...>` | Additional workflow inputs (key=value) |

## Development

```bash
# Run in dev mode (TypeScript directly)
npm run dev

# Build	npm run build

# Type check
npm run typecheck
```

## Architecture

The CLI is built with a modular command structure:

- `src/commands/` - Individual command implementations
- `src/utils/` - Shared utilities (GitHub API, UI helpers)
- `src/types/` - TypeScript type definitions

New commands are registered in `src/cli.ts` via `register*Command()` functions.

## Prerequisites

- Node.js >= 18
- GitHub CLI (`gh`) installed and authenticated
- Access to Vast-menu organization repositories
