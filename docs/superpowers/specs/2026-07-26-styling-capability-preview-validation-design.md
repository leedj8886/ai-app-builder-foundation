# Styling Capability Preview and Validation Design

**Date:** 2026-07-26

## Context

Snapshot `6a657633a57f5bdf2acfccd0` contains `bg-blue-100`, but its
Preview remains white. The Snapshot imports a stylesheet containing Tailwind
directives and declares Tailwind as a development dependency, but it contains
no PostCSS or Tailwind configuration. Vite therefore completes successfully
without expanding the directives. Sandpack receives only runtime dependencies,
so it cannot compile Tailwind either.

This produces a false positive: TypeScript and Vite report success while the
requested visual change is absent.

Styling is one aspect of an application rather than a single global project
mode. A project may use plain CSS, CSS Modules, Tailwind, styled-components, or
more than one approach at once. `project.settings.styling` must not be the
authoritative switch for Preview or validation behavior.

## Goals

- Make Preview and production validation interpret styling consistently.
- Support old Snapshots without rewriting persisted data.
- Detect styling capabilities from project evidence rather than metadata alone.
- Support multiple styling capabilities in one project.
- Reject builds where styling directives remain unprocessed.
- Produce actionable diagnostics for missing configuration, dependencies, or
  stylesheet entry imports.

## Non-goals

- Building a visual Design System editor.
- Migrating persisted old Snapshots.
- Supporting arbitrary build systems beyond the current React/Vite project
  contract.
- Saving compiled CSS artifacts in MongoDB.
- Treating every `className` as Tailwind usage without stronger evidence.

## Architecture

### Styling capability resolution

Introduce a `StylingCapabilityResolver` that inspects:

- package dependencies and development dependencies;
- configuration files such as `tailwind.config.*` and `postcss.config.*`;
- stylesheet directives and file naming, including `@tailwind` and
  `*.module.css`;
- source usage such as styled-components imports;
- stylesheet imports from application entry files;
- `project.settings.styling` as a weak hint only.

The resolver returns multiple capabilities when appropriate:

```ts
interface StylingResolution {
  capabilities: StylingCapability[];
  evidence: Partial<Record<StylingCapability, string[]>>;
  issues: StylingIssue[];
}
```

Supported initial capabilities are:

- `plain-css`;
- `tailwind`;
- `css-modules`;
- `styled-components`.

File and dependency evidence takes precedence over metadata. Ambiguous evidence
is reported rather than silently forcing a single mode.

### Adapter registry

A `StylingAdapterRegistry` maps each detected capability to an isolated adapter.
Adapters may be composed for mixed projects.

Each adapter owns three responsibilities:

1. provide initial template files and dependencies when applicable;
2. augment an in-memory Preview model for backward compatibility;
3. validate source configuration and production build evidence.

The Tailwind adapter owns Tailwind/PostCSS versions, compatible configuration
templates, source scan patterns, Preview dependencies, and compiled-CSS
inspection. CSS Modules and styled-components adapters validate only their own
contracts and never inject Tailwind.

Plain CSS is the fallback capability and requires no special configuration.

### Shared configuration generation

New project templates and old-Snapshot Preview augmentation use the same
adapter-owned configuration factories. This prevents Preview and production
validation from drifting.

New projects that use Tailwind persist:

- `tailwind.config.js`;
- `postcss.config.js`;
- Tailwind directives in the global stylesheet;
- the stylesheet import in the application entry;
- compatible Tailwind, PostCSS, and Autoprefixer development dependencies.

## Data Flow

### Preview

1. Load the active Snapshot without modification.
2. Resolve styling capabilities from files and package metadata.
3. Run each detected adapter against a cloned Preview model.
4. For an old Tailwind Snapshot with strong Tailwind evidence but missing
   configuration, add compatible Tailwind/PostCSS files and dependencies only
   to the Sandpack model.
5. Start Sandpack with the augmented files and all required build dependencies.
6. If augmentation cannot produce a coherent model, show an actionable Preview
   error instead of rendering an unstyled success state.

Preview augmentation must be pure: it does not update MongoDB, create a
Snapshot, or appear as a user-authored file change.

### Validation

1. Resolve capabilities from the candidate project.
2. Run adapter source-contract checks before dependency installation.
3. Run the existing dependency, type-check, and build phases.
4. Locate emitted CSS assets.
5. Ask each active adapter to validate its build evidence.
6. Persist structured styling diagnostics with the validation result.

For Tailwind, validation fails when:

- Tailwind directives exist without a working PostCSS integration;
- the application entry does not import the relevant stylesheet;
- emitted CSS still contains unexpanded `@tailwind` directives;
- strong utility usage evidence exists but emitted CSS contains no corresponding
  utility output.

The final utility-output check uses deterministic fixture classes for platform
templates and evidence-derived selectors for generated projects. It does not
assume that every valid Tailwind build must contain a specific color class.

## Error Model

Add `STYLING_CONFIGURATION_ERROR` as a structured code under validation
diagnostics. Diagnostics include:

- capability;
- phase (`source-contract` or `build-evidence`);
- affected file when known;
- sanitized explanation;
- whether Preview compatibility can compensate.

Examples:

- `Tailwind directives found, but PostCSS does not load the Tailwind plugin.`
- `src/index.css is not imported by src/main.tsx.`
- `The emitted CSS still contains unexpanded @tailwind directives.`

Styling configuration errors are deterministic project errors, not
infrastructure errors, and must not trigger registry/network retries.

## Compatibility Rules

- Old Snapshots remain byte-for-byte unchanged in persistence.
- Old Tailwind Snapshots receive Preview-only compatibility when evidence is
  strong enough.
- New Snapshots include complete configuration through the project template and
  generation contract.
- `project.settings.styling` remains available as a generation/UI hint, but does
  not control runtime capability selection.
- Mixed projects activate every supported adapter detected from evidence.
- Unknown styling libraries fall back to normal build behavior and generate an
  informational unresolved-capability diagnostic only when evidence is
  ambiguous.

## Testing

### Unit tests

Capability resolution covers:

- plain CSS;
- Tailwind;
- CSS Modules;
- styled-components;
- mixed Tailwind and CSS Modules;
- metadata that conflicts with source evidence;
- weak `className` evidence without Tailwind dependencies or directives.

Adapter tests cover:

- pure, non-mutating Preview augmentation;
- compatible Tailwind/PostCSS file generation;
- no Tailwind injection for non-Tailwind projects;
- composed adapters for mixed projects.

### Preview tests

- An old Snapshot missing Tailwind/PostCSS configuration receives the missing
  files and dependencies in the Sandpack model.
- The persisted Snapshot input remains unchanged.
- An unrecoverable compatibility error produces an explicit Preview error.

### Validator tests

- A normal Tailwind build passes.
- Vite success with unexpanded Tailwind directives fails.
- Missing stylesheet imports fail.
- Missing or incompatible configuration fails.
- Plain CSS, CSS Modules, and styled-components projects are not subjected to
  Tailwind-only assertions.

### End-to-end tests

Docker browser Smoke creates an old-Snapshot-equivalent fixture containing
`bg-blue-100`, opens Preview, and asserts its computed background color rather
than merely checking for the class name. API Smoke asserts that the same fixture
passes production validation only after utility CSS is emitted.

## Acceptance Criteria

- Preview and production validation agree for the same Snapshot.
- Old Snapshots work without regeneration or database migration.
- Tailwind is injected only when project evidence identifies Tailwind.
- Multiple styling approaches can operate together.
- A successful Vite exit with ineffective styling cannot produce a passing
  validation result.
- Diagnostics identify the missing configuration, dependency, entry import, or
  unexpanded directive.
- The known `bg-blue-100` regression is covered by a computed-style browser
  assertion.
