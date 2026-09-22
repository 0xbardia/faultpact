# FaultPact Design System

## Direction

FaultPact uses a warm paper foundation, ink typography, coral action color,
acid-lime confirmation color, and restrained yellow warnings. The interface is
an infrastructure console, not an AI visual theme: no purple/cyan glow system,
decorative particle field, fake activity, or generic glass dashboard.

## Tokens

The source of truth is `apps/web/app/globals.css`:

- `--paper`, `--paper-deep`, `--ink`, and `--muted` define the surface and text
  hierarchy.
- `--coral` is the primary action/signal color.
- `--lime` is used for healthy/confirmed states.
- `--yellow` is reserved for pending or caution states.
- `--line`, `--shadow`, and the radius tokens define restrained surfaces.
- `--ease-out`, `--fast`, `--normal`, and `--slow` define interaction motion.

The CSS includes mobile breakpoints and a `prefers-reduced-motion` override.

## Typography

Display headings use a condensed, high-contrast treatment; body copy stays
plain and readable; technical values use a monospace face. Addresses, hashes,
transaction methods, and raw protocol values are always visually distinct.

## Product glyphs

`components/ui.tsx` contains small inline SVG glyphs for Pact, Bond, Service,
Coverage, Incident, Evidence, Resolution, and Settlement. Utility controls can
use ordinary text/buttons; protocol concepts should use these product glyphs.

## Interaction rules

- Visible focus remains enabled.
- Buttons are real buttons and navigation is real links.
- Loading, empty, error, and stale states are explicit.
- Motion communicates state progression. Reduced motion preserves the same
  information hierarchy without animation.
- Tables collapse through responsive overflow/card-safe layouts rather than
  shrinking critical values into unreadable text.

