# The Design System: Editorial Precision for Bug Tracking

## 1. Overview & Creative North Star

**Creative North Star: "The Deep-Sea Cartographer"**

Standard bug trackers are often cluttered, noisy, and anxiety-inducing. This design system rejects the "spreadsheet-in-a-box" aesthetic. Instead, we treat data as a high-end editorial experience. By utilizing a deep, monochromatic foundation punctuated by laser-focused highlights, we transform a technical dashboard into a calm, authoritative environment.

The system breaks the "template" look through **Tonal Layering**. We move away from the rigid, boxed-in grids of traditional SaaS and toward a layout that feels carved out of a single piece of dark stone. We use intentional asymmetry—such as a wide-set sidebar and tight, high-contrast typography—to guide the eye through complex data sets without visual fatigue.

---

## 2. Colors & Surface Philosophy

The palette is rooted in the depths of the ocean: dark, stable, and immersive.

### The Palette

- **Surface (Main Background):** `#001620` (The void)

- **Surface-Container-Low:** `#07222e` (Secondary grounding)

- **Surface-Container-High:** `#142d39` (Interactive layers)

- **Primary Action:** `#6ed2ff` (Active UI) | Container: `#34a3ce`

- **Attention/Secondary:** `#55dad3` (Status markers) | Container: `#02ada7`

- **Highlight/Link:** `#dded1f` (Callouts & interactivity)

- **Success:** `#48e271` | **Warning:** `#fc8a14` | **Danger:** `#e0353d`

### The "No-Line" Rule

To achieve a premium feel, **1px solid borders are prohibited for sectioning.** We define boundaries through background color shifts. A sidebar sitting on the `surface` should be defined by its `surface-container-low` background, not a dividing line. This forces the designer to rely on proximity and color weight rather than structural "crutches."

### Surface Hierarchy & Nesting

Treat the UI as a series of physical layers.

- **The Foundation:** Use `surface` for the global background.

- **The Content Bed:** Use `surface-container-low` for the main dashboard body.

- **The Cards:** Use `surface-container-high` for bug cards or data modules.

This "nested" depth creates a natural focal point on the most important information (the cards) because they are visually the "closest" to the user.

### Signature Textures

While the user requested "flat," we elevate this through **Atmospheric Gradients.** For primary CTAs, use a subtle linear transition from `primary` (`#6ed2ff`) to `primary-container` (`#34a3ce`). This prevents the UI from looking "cheap" or "default" while maintaining the overall flat aesthetic.

---

## 3. Typography: The Editorial Voice

We use **Asap** for all text (loaded from Google Fonts) to provide a clean, high-contrast experience.

- **Display (3.5rem - 2.25rem):** Use sparingly for high-level metrics (e.g., total open bugs). Bold weight, tight letter spacing.

- **Headline (2rem - 1.5rem):** For page titles and major sections.

- **Title (1.375rem - 1rem):** For bug titles within cards. This is where the user spends the most time; ensure it is high-contrast `on-surface`.

- **Body (1rem - 0.75rem):** Used for descriptions. Maintain a slightly lower contrast (`on-surface-variant`) to keep the UI from feeling overwhelming.

- **Label (0.75rem - 0.6875rem):** Uppercase, 0.05em letter spacing for metadata (Tags, IDs, Timestamps).

---

## 4. Elevation & Depth: Tonal Layering

In this design system, shadows are an atmospheric byproduct, not a structural requirement.

- **The Layering Principle:** Depth is achieved by stacking. A `surface-container-lowest` card on a `surface-container-low` section creates a soft, "sunken" effect. Conversely, a `surface-container-highest` element creates "lift."

- **Ambient Shadows:** For floating elements (Modals/Popovers), use extra-diffused shadows: `rgba(0, 0, 0, 0.4)` with a blur of `32px` and `0px` spread. The shadow color must never be pure black; it should be a deep navy tint of the background.

- **The "Ghost Border" Fallback:** If a border is required for accessibility, use the `outline-variant` token at **15% opacity**. It should be felt, not seen.

- **Glassmorphism:** For the Sidebar or top Navigation, use `surface-container` with a `20px` backdrop-blur. This lets the data "bleed" through as the user scrolls, creating a sense of continuity.

---

## 5. Components

### Buttons

- **Primary:** Background: `#34a3ce`; Text: `on-primary`. 5px radius. No border.

- **Secondary:** Background: `surface-container-high`; Text: `primary`.

- **Tertiary/Highlight:** Background: `#dded1f`; Text: `#001620`. Reserved for "High Priority" or "Resolve" actions.

### Cards & Lists

**Forbid the use of divider lines.** Separate bug entries using a `12px` spacing scale or a subtle background toggle (zebra striping using `surface-container-low` and `surface-container-lowest`).

### Input Fields

- **States:** Default background is `surface-container-low`. On focus, change background to `surface-container-highest` and add a `2px` underline in `#dded1f` (Highlight).

- **Roundedness:** Maintain a strict `0.25rem` (5px) for all inputs to match the brand identity.

### Chips (Bug Tags)

Use high-saturation backgrounds with low-saturation text (e.g., a `danger` container for "Critical" bugs) but keep them small and pill-shaped to avoid distracting from the bug title.

### Dashboard-Specific Components

- **Priority Heatmap:** A grid of blocks using the `surface-container` tiers to show activity density without using numbers.

- **The "Focus Bar":** A vertical `#34a3ce` strip on the far left of a bug card to indicate the currently selected item.

---

## 6. Do’s and Don’ts

### Do:

- **Do** use vertical white space as a structural element.

- **Do** use the `tertiary-fixed` (`#dded1f`) color for hover states on links and interactive icons to create a "electric" feel.

- **Do** ensure text contrast ratios meet AA standards, especially when using `#dded1f` as a background.

### Don't:

- **Don't** use 100% white (#FFFFFF). Use `on-surface` (`#cce6f7`) for a softer, premium reading experience.

- **Don't** use a shadow on every card. Only use shadows for elements that physically "float" over other content (Modals/Tooltips).

- **Don't** use rounded corners larger than `5px` for primary UI elements. Sharpness equals precision in a bug tracker.
