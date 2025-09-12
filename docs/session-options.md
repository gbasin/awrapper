# Session Options: Model, Tools, Sandbox, Approvals

Goals

- Add per-session controls to the New Session flow for:
  - Model selection
  - Approval policy
  - Sandbox mode
  - Tools: Plan tool, Web search (and keep View image / Apply patch on)
- Store the effective settings in the `sessions` table
- Spawn Codex proto with matching `-c` overrides

Defaults

- Model: `gpt-5-high`
- Approvals: `never`
- Sandbox: `workspace-write`
- Tools: all on by default
  - include_plan_tool = true
  - tools.web_search = true
  - include_view_image_tool = true
  - include_apply_patch_tool = true

Server API

- `GET /config` → include defaults so UI can prefill:
  - `model_default: string`
  - `approval_policy_default: "never" | "on-request" | "on-failure" | "untrusted"`
  - `sandbox_mode_default: "read-only" | "workspace-write" | "danger-full-access"`
  - `include_plan_tool_default: boolean`
  - `web_search_default: boolean`

- `POST /sessions` (new optional fields):
  - `model?: string`
  - `approval_policy?: "never" | "on-request" | "on-failure" | "untrusted"`
  - `sandbox_mode?: "read-only" | "workspace-write" | "danger-full-access"`
  - `include_plan_tool?: boolean`
  - `web_search?: boolean`

Persistence

- Extend `sessions` table with columns:
  - `model text`
  - `approval_policy text`
  - `sandbox_mode text`
  - `include_plan_tool integer`
  - `web_search integer`

Spawn Mapping (Codex proto)

- Build `codex proto` argv with `-c` overrides only (proto reads config, not wire configure):
  - `-c model="<model>"`
  - `-c approval_policy="<policy>"`
  - `-c sandbox_mode="<mode>"`
  - `-c include_plan_tool=<true|false>`
  - `-c include_apply_patch_tool=<true|false>`
  - `-c include_view_image_tool=<true|false>`
  - `-c tools.web_search=<true|false>`

UI (New Session)

- Add inputs:
  - Model: text input
  - Approval: select (never, on-request, on-failure, untrusted)
  - Sandbox: select (read-only, workspace-write, danger-full-access)
  - Plan tool: checkbox
  - Web search: checkbox
  - Persist last selections to localStorage

Notes (Codex CLI)

- Config keys come from Codex core:
  - `include_plan_tool`, `include_apply_patch_tool`, `include_view_image_tool`, `tools.web_search`
  - `approval_policy` (kebab-case enum)
  - `sandbox_mode` (kebab-case enum)
  - Default model upstream is `gpt-5`; we override to `gpt-5-high` by default

Open questions

- None (for v0): we will surface all toggles in New Session and show effective settings in Session detail later.

