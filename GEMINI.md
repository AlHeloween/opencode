# OpenCode Project (`opencode`)

## Project Overview

This repository contains **OpenCode**, an open-source, AI-powered coding agent. It is designed with a TUI (Terminal User Interface) first approach, but also includes a beta desktop application and a web interface.

The project is a large-scale TypeScript monorepo managed with `bun` as the package manager and `turborepo` for orchestrating tasks.

### Key Technologies

*   **Core & CLI:** TypeScript, Bun
*   **Frontend (TUI, Web, Desktop):** SolidJS
*   **Desktop App:** Tauri (with a Rust backend)
*   **Build & Task Runner:** Turborepo
*   **Infrastructure & Deployment:** SST (Serverless Stack) deploying to Cloudflare
*   **Native Modules:** The project incorporates Rust for performance-critical components.

### Architecture

The architecture is based on a client-server model. The core logic resides in a server that can be run headlessly, and various clients (TUI, Web, Desktop) can connect to it.

The monorepo is organized into multiple packages located in the `packages/` directory, including:
*   `opencode`: The core business logic and CLI command.
*   `console`: The terminal-based UI (TUI).
*   `app`: Shared UI components used across the different frontends.
*   `desktop`: The Tauri wrapper for the native desktop application.
*   `web`: The web interface.
*   `sdk`: The client SDK for interacting with the OpenCode server.

## Building and Running

### Prerequisites

*   Bun `1.3+`

### Initial Setup

To install all dependencies, run the following command from the root of the repository:
```bash
bun install
```

### Development

The `CONTRIBUTING.md` file provides extensive detail on different development workflows.

*   **Run the TUI (Terminal User Interface):**
    ```bash
    bun dev
    ```
    To run against a specific directory:
    ```bash
    bun dev <path/to/directory>
    ```

*   **Run the Desktop App (Tauri):**
    ```bash
    bun dev:desktop
    ```

*   **Run the Web App:**
    ```bash
    bun dev:web
    ```

*   **Run the Storybook UI component library:**
    ```bash
    bun dev:storybook
    ```

### Building for Production

The full build process is complex and multi-platform, orchestrated via GitHub Actions in `.github/workflows/publish.yml`.

For local development builds, the primary script is `_build.ps1` (on Windows). The core build logic is in `packages/opencode/script/build.ts`.

To create a single-platform binary for testing:
```bash
./packages/opencode/script/build.ts --single
```

### Testing

Tests are configured per-package. The root `package.json`'s `test` script is disabled to prevent accidental execution. Use `turbo` to run tests for specific packages or use package-specific scripts.

*   **Type Checking:**
    ```bash
    bun turbo typecheck
    ```

## Development Conventions

The `CONTRIBUTING.md` file is the primary source for contribution guidelines.

*   **Pull Requests:**
    *   All PRs must be linked to an existing issue.
    *   PR titles must follow the **Conventional Commit** specification (e.g., `feat: ...`, `fix(app): ...`, `docs: ...`).
    *   PRs should be small, focused, and include a clear explanation of the changes.

*   **Code Style:**
    *   **Immutability:** Prefer `const` over `let`.
    *   **Control Flow:** Avoid `else` statements where possible.
- **Error Handling:** Use promise `.catch()` over `try/catch` blocks when applicable.
    *   **Types:** Strive for precise types and avoid using `any`.
    *   **Naming:** Use concise and descriptive names.
    *   **Runtime:** Utilize `Bun` APIs (e.g., `Bun.file()`) where appropriate.

*   **Formatting:** The project uses `prettier` for code formatting. Configuration is in the root `package.json`.
