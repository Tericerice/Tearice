# DropPoint FileShelf design contract

## Intent

DropPoint FileShelf is a compact, always-on-top desktop handoff surface. Each
dropped file or folder is a first-class card so the user can identify and drag
one item without unpacking a merged stack.

This first iteration preserves the calm, pale character of upstream DropPoint.
It does not introduce a new visual brand or decorative motion.

## Tokens

- Canvas: warm white `rgba(255, 250, 240, 0.96)` with platform blur.
- Raised surface: white at 88% opacity.
- Primary label: `#24272d`; secondary label: `#74777f`.
- Border: `rgba(36, 39, 45, 0.12)`; accent: `#4d7cff`.
- Radius: 16 px window, 12 px cards, 10 px controls.
- Spacing rhythm: 4 / 8 / 12 / 16 px.
- Typography: platform system font, 13 px body and 12 px supporting copy.
- Shadow: one restrained window shadow and one card hover elevation.

## Layout and components

- One 440 x 320 px shelf window; file content scrolls inside the frame.
- A 52 px title bar remains the draggable window region.
- Empty state accepts file/folder drops across the content surface.
- Populated state uses a three-column card grid.
- Every card contains one preview or type icon and one truncated filename.
- Card actions are individual drag, remove, and keyboard focus.
- The footer exposes one clear-all action and an item count.

## States

- Empty: centered drop instruction.
- Drag over: accent border and tint on the content surface.
- Populated: independent cards at rest.
- Hover/focus: visible border and restrained elevation; remove control appears.
- Dragging: source card receives an accent outline; the item remains afterward.

## Accessibility

- Cards and buttons have visible keyboard focus.
- Filenames remain available through `title` and accessible labels when
  visually truncated.
- Motion is limited to short hover/state transitions and respects
  `prefers-reduced-motion`.

## Accepted first-iteration limits

- Image files receive thumbnails; folders and other formats use type icons.
- The shelf is session-only; persistence across app restarts is deferred.
- Window resizing and a broader visual redesign are deferred.
