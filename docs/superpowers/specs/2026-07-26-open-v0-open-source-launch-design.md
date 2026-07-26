# Open v0 Open-Source Launch Design

**Date:** 2026-07-26
**Status:** Approved direction, pending written-spec review

## 1. Objective

Prepare this repository for an open-source launch as a foundation that helps
teams build and operate their own v0-style AI application platform.

The launch must not position the project as another free end-user clone of v0,
Lovable, Bolt, or Dyad. Its primary value is the reusable platform architecture:
multi-user project management, asynchronous agent execution, auditable progress,
project snapshots, real build validation, failure classification, and targeted
repair.

The launch succeeds when a developer who does not know the project can:

1. Understand the differentiation from the repository landing page.
2. Start the complete system without private setup instructions.
3. Generate and iteratively edit a React application.
4. Observe the validation and recovery pipeline.
5. Identify how to customize the model provider, agent behavior, UI, and
   infrastructure for an internal or commercial platform.

## 2. Target Audience

### Primary audience

- Platform and developer-experience teams building internal AI development
  tools.
- Startups building a vertical AI app builder.
- Engineering teams that need a self-hosted prompt-to-app environment.
- Developers studying production-oriented AI coding agent architecture.

### Secondary audience

- Individual developers who want to run and extend a multi-user AI app builder.
- DeepSeek, Kimi, and OpenAI-compatible API users looking for a complete
  reference project.
- Open-source contributors interested in agent reliability, validation, and
  recovery.

### Explicit non-goal

The initial launch will not claim to be the most polished consumer alternative
to v0, Lovable, Dyad, or Bolt. Competing feature-for-feature with mature
end-user products would obscure the platform-builder use case and create
expectations the current release does not meet.

## 3. Positioning

### Category

Open-source, self-hostable foundation for building a v0-style AI app platform.

### English positioning statement

> An open-source, self-hostable foundation for building your own v0-style AI
> app platform—with auditable agent runs and build-verified code generation.

### Chinese positioning statement

> 面向开发团队的开源、自托管 AI App Builder 平台底座，内置多用户项目管理、
> 异步 Agent、实时执行轨迹、代码快照、真实构建验证和定向错误修复。

### Primary message

> Do not just generate code. Generate code that builds.

Chinese:

> 不只是生成代码，而是生成能够通过真实构建的代码。

### Differentiation

The project should consistently emphasize three differentiators:

1. **Build-verified generation:** a run is not complete until the generated
   project passes structural validation, dependency preparation, TypeScript
   checking, and a production build.
2. **Targeted recovery:** failures are classified as code, dependency, or
   infrastructure errors so the platform can repair or retry the correct layer
   instead of blindly regenerating the whole application.
3. **Platform architecture:** the repository provides authentication, projects,
   asynchronous workers, durable events, real-time progress, snapshots, and
   self-hosted infrastructure rather than only a prompt-and-preview component.

Model-provider branding is supporting evidence, not the main category. The
project should present DeepSeek, Kimi, or other OpenAI-compatible providers as
replaceable configuration.

## 4. Naming and Repository Identity

The current names `v0-by-kimi` and `my-v0` do not match the implementation or
the intended long-term positioning. Before public promotion, the project needs
an independent, provider-neutral identity.

The final name must:

- Avoid implying an official relationship with Vercel or v0.
- Avoid coupling the project to one model provider.
- Be easy to pronounce and search.
- Support a repository name, package namespace, and future website.

Renaming will be a separate decision. Until a name is selected, launch assets
should use the descriptive category rather than inventing a temporary brand.

## 5. Repository Landing Page

The README is the primary landing page and must use the following information
order:

1. Project name and one-sentence positioning.
2. Live demo, quick start, architecture, and roadmap links.
3. A 20–30 second demo showing generation, validation failure, targeted repair,
   successful build, and snapshot preview.
4. A short "Why this project?" section.
5. The validation pipeline:

   `Plan → Generate → Install → Type-check → Build → Diagnose → Repair → Snapshot`

6. Four headline capabilities:
   - Build-verified generation
   - Targeted repair instead of blind regeneration
   - Auditable real-time agent runs
   - Self-hosted multi-user platform
7. A reproducible quick start.
8. Architecture and extension points.
9. Current capabilities and honest limitations.
10. Configuration, model providers, troubleshooting, roadmap, contribution,
    security, and license information.

The README must not lead with a long technology-stack list. The technology
stack should support the value proposition after the reader understands the
problem being solved.

## 6. Launch Demo

The flagship launch asset is a short, authentic failure-recovery demonstration.

### Scenario

1. Prompt for a recognizable application such as an operations dashboard with
   charts and filters.
2. Show the generated plan and file operations.
3. Show a real dependency or TypeScript validation failure.
4. Show the failure classification and concise diagnostic.
5. Show a targeted repair without regenerating the entire project.
6. Show type checking and production build succeeding.
7. Show the validated snapshot in the preview.

### Constraints

- The recording must represent behavior available in the tagged release.
- It must not imply that every prompt succeeds.
- It must not hide manual steps needed by a new user.
- The same scenario and prompt must be documented so another user can reproduce
  it.

### Reusable visual message

`Prompt → Plan → Generate → Real Build → Diagnose → Targeted Repair → Verified Snapshot`

## 7. Open-Source Readiness

The launch is blocked until the following items are complete:

- The repository uses Apache-2.0. Its explicit patent grant is appropriate for a
  reusable platform foundation and is more protective for organizational
  adopters than a license without patent terms.
- `.env.example` documents every required and commonly customized setting
  without secrets.
- A clean-machine quick-start path launches MongoDB, Redis, the API server, the
  worker, and the web app.
- The README correctly distinguishes development, smoke, and production-model
  execution.
- No private credentials, internal URLs, or local-only assumptions are tracked.
- `CONTRIBUTING.md`, security reporting guidance, and a public roadmap exist.
- GitHub description, social preview, topics, and release metadata are set.
- The repository contains at least one reproducible example prompt.
- Current limitations are documented.

The default quick start should optimize for the shortest reliable path. Docker
Compose is the preferred default if it can provide a complete working system;
manual workspace commands should remain available for contributors.

## 8. Validation and Acceptance Criteria

Before the public announcement, at least five people who did not build the
project should test the release using only public documentation.

The release is ready when:

- At least four of five testers can start the system within ten minutes.
- Testers do not require private setup instructions.
- Each successful tester can complete one generation and one iterative edit.
- The documented demo prompt can reach a validated snapshot.
- Installation failures produce actionable troubleshooting information.
- Server and web unit tests pass.
- The production build passes.
- Any unverified integration or platform behavior is explicitly disclosed.

The current unit-test and build results are useful release evidence, but they do
not replace clean-machine onboarding validation.

## 9. Promotion Sequence

Promotion will be staggered so early onboarding failures can be fixed before
larger audiences arrive.

### Stage 1: controlled release

- Publish a tagged release and complete repository landing page.
- Invite a small group of platform engineers, AI coding developers, and
  self-hosting users.
- Fix installation and first-run problems.

### Stage 2: technical communities

- Reddit communities focused on local models, self-hosting, open source, and AI
  coding.
- V2EX and Chinese developer communities with an architecture-focused
  development retrospective.
- X with the short recovery demo and a technical thread.
- Hacker News only after the public setup and demo are reliable.

### Stage 3: durable content

- Why AI-generated code needs real build validation.
- How to distinguish code, dependency, and infrastructure failures.
- How to design recoverable and auditable coding-agent event flows.
- A release driven by concrete community feedback.

Product Hunt and broad no-code audiences are deferred until the hosted demo and
onboarding are polished enough for non-developers.

## 10. Success Metrics

Stars are a useful distribution signal but not the primary proof of product
value.

Initial launch goals:

- 20 people run the project successfully.
- 5 substantive external issues or discussions are created.
- 2 external contributors submit useful changes.
- 1 independent tutorial, article, or demo is published.
- The project receives concrete inquiries about internal deployment,
  customization, or provider integration.

A smaller audience asking how to deploy the platform internally is a stronger
validation of this positioning than a larger number of passive stars.

## 11. Scope and Delivery Order

### Launch-critical

- Provider-neutral project identity
- License
- README and screenshots/demo
- Complete quick start and environment example
- Architecture documentation
- Contribution, security, and roadmap documents
- GitHub repository metadata
- Tagged release

### Valuable after the launch baseline

- Additional OpenAI-compatible provider configuration
- Public hosted demo
- One-click deployment
- Example gallery and prompts
- Runtime cost and reliability measurements

### Deferred

- Visual design editor parity
- Broad template library
- GitHub two-way synchronization
- Team collaboration features
- MCP integrations
- Multiple production deployment targets
- Mobile application generation

The launch work must not expand into feature parity with mature consumer AI app
builders.

## 12. Risks and Mitigations

### "Another v0 clone" perception

Lead with platform builders, validation, auditability, and recovery. Do not lead
with visual similarity to v0.

### Setup complexity

Treat clean-machine onboarding as a release acceptance test and provide one
canonical startup path.

### Provider-name confusion

Adopt a provider-neutral identity and document model providers as adapters.

### Overclaiming reliability

Publish the validation behavior and limitations. Do not claim production
readiness or universal prompt success without measured evidence.

### Trademark confusion

Use "v0-style" only to explain the category and state that the project is not
affiliated with Vercel. Obtain legal review before using another company's mark
in permanent branding.

### Contributor inactivity

Seed a small, prioritized roadmap and good-first issues, respond quickly during
the launch window, and publish follow-up releases based on real feedback.

## 13. Next Step

After this written design is reviewed, create a repository implementation plan
that breaks the launch work into independently verifiable changes. The plan
must preserve existing uncommitted product work and must not combine unrelated
feature development with open-source launch preparation.
