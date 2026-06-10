// Canonical button styles. Use these constants for "default" primary
// actions so new buttons can't drift into one-off shapes again.
//
// Intentional non-users (designed variants — don't convert without
// a design call):
//   - Nav.jsx top-right CTA: pill shape (rounded-full) reads as a
//     header CTA distinct from body buttons.
//   - BookForm save button: bigger commit gesture (px-6 py-2,
//     font-semibold) — the form's terminal action.
//   - AuditWizard/TextModeForm answer buttons: tile-shaped (px-4 py-3,
//     flex-col) for the wizard's grid layout.
//
// Both constants assume `bg-oak` for the primary color and
// `text-neutral-950` for foreground (the parchment-on-deep-bg pairing).
// The polished motion-safe scale + transition-[transform,background-color]
// is the "designed" shape; primaryButtonSm uses transition-colors only
// for the older compact contexts where the animation would be busy.
export const primaryButton =
  'text-sm font-medium bg-oak hover:bg-leather disabled:opacity-60 ' +
  'motion-safe:active:scale-[0.98] text-neutral-950 px-4 py-2 rounded-lg ' +
  'transition-[transform,background-color] ease-out duration-150';

export const primaryButtonSm =
  'text-xs font-semibold bg-oak hover:bg-leather disabled:opacity-60 ' +
  'text-neutral-950 px-3 py-1.5 rounded transition-colors';
