# Sidebar interaction design QA

- Source visual truth:
  - `/var/folders/jw/3_lnf4hs709b06my528g5blr0000gn/T/codex-clipboard-8142c8f5-4045-46d1-87ed-bce074f2e736.png`
  - `/Users/a015265/Desktop/截屏2026-08-02 09.23.45.png`
- Implementation screenshots:
  - `/Users/a015265/.codex/worktrees/5dfa/v0-by-kimi/work/sidebar-collapsed-1920x960.png`
  - `/Users/a015265/.codex/worktrees/5dfa/v0-by-kimi/work/sidebar-hover-preview-1920x960.png`
  - `/Users/a015265/.codex/worktrees/5dfa/v0-by-kimi/work/sidebar-single-expand-button.png`
  - `/Users/a015265/.codex/worktrees/5dfa/v0-by-kimi/work/top-nav-left-aligned.png`
- Full-view comparison evidence: `/Users/a015265/.codex/worktrees/5dfa/v0-by-kimi/work/sidebar-design-qa-comparison.png`
- Focused-region comparison evidence: `/Users/a015265/.codex/worktrees/5dfa/v0-by-kimi/work/sidebar-design-qa-focused.png`
- Browser viewport: requested `1920 x 960` CSS px; rendered screenshot content was `1912 x 956` px at 1x density.
- Source dimensions: collapsed reference `1920 x 958` px; open-sidebar reference `1916 x 961` px.
- Normalization: full views were proportionally fit into equal `960 x 480` comparison panels. Focused evidence uses native-pixel top-left and sidebar crops.
- State: desktop conversation detail, sidebar pinned, collapsed, temporary preview open, and pinned-from-preview.

**Findings**

- No actionable P0/P1/P2 visual or interaction differences remain for the requested behavior.
- Fonts and typography: existing product type scale, weights, truncation, and line heights are unchanged. The long conversation subtitle remains fully owned by the workspace header and is no longer covered by the expand control.
- Spacing and layout rhythm: the collapsed expand control is `36 x 36` at `(8, 6)` in the top bar and ends at `y=42`; the workspace header begins at `y=49`, leaving a clear separation. The temporary sidebar preserves the existing pinned width of `272px` and floats above content without changing the workspace grid.
- Header alignment follow-up: on the detail page, the pinned-state brand begins at `x=16`. In the collapsed state, the expand icon occupies `x=8..44` and the brand begins at `x=56`, giving the two controls a compact 12px gap at the left edge instead of centering them inside the former 1440px container.
- Colors and visual tokens: the sidebar continues to use the existing neutral background, border, shadow, hover, focus-ring, and foreground tokens. No new palette was introduced.
- Image and icon fidelity: no raster assets were needed. Existing Lucide panel icons are reused; no custom SVG, CSS drawing, placeholder, or text-glyph icon was introduced.
- Copy and content: visible navigation and conversation copy are unchanged. New accessible names distinguish `Preview sidebar`, `Pin sidebar open`, and `Expand sidebar`.
- Responsive behavior: desktop hover/focus preview is limited to the `lg` breakpoint. At `900 x 800`, the pinned desktop sidebar and edge trigger are both hidden.

**Interaction checks**

- Collapsing removes the pinned sidebar and preserves the workspace content.
- The top-left expand button pins the sidebar without overlapping the conversation heading.
- The 8px left-edge trigger exposes the floating sidebar through the shared hover/focus-within region.
- While the floating sidebar is visible, the top-left expand control is hidden so only the sidebar's pin control remains.
- Moving focus outside the floating region hides it automatically; the same CSS group owns pointer leave behavior.
- The floating sidebar's panel button converts the preview into the pinned grid sidebar.
- Browser console errors checked: none.

**Comparison history**

- First pass: the temporary sidebar depended on JavaScript mouse-enter state on an 8px target, creating avoidable fragility for fast pointer movement.
- Fix: replaced transient JavaScript state with a shared CSS `group-hover` / `group-focus-within` region so the edge trigger and floating panel form one continuous interactive surface. Added reduced-motion handling through Tailwind's motion variant.
- Post-fix evidence: focused preview screenshot shows the sidebar floating over the workspace; focus leaving the region hides it; both pin entry points restore the pinned sidebar. No P0/P1/P2 issue remains.
- Follow-up pass: the collapsed top-bar expand control remained visible behind the floating sidebar, producing two expand controls. Moved that control into a sibling peer state and hide it whenever the preview region is hovered or focused. Browser evidence confirms `topExpandVisible: false` while `pinVisible: true`, then restores the top control after the preview closes.
- Header-alignment pass: removed the centered max-width wrapper from the detail-page top bar while retaining it on the home page. Browser measurements confirm the icon and AI App Builder mark are now left-aligned, with no console errors.

**Open Questions**

- None. The reference supplies the interaction model, while the existing product's sidebar width, typography, colors, and navigation content remain intentionally authoritative.

**Implementation Checklist**

- [x] Move the collapsed expand control into the top bar.
- [x] Add a desktop left-edge preview trigger.
- [x] Keep the floating sidebar open while the pointer or keyboard focus is inside it.
- [x] Auto-hide when the floating region is left.
- [x] Support pinning from both the top bar and the floating sidebar.
- [x] Preserve the existing mobile breakpoint behavior.
- [x] Verify the rendered states and browser console.

**Follow-up Polish**

- None required for this interaction change.

final result: passed
