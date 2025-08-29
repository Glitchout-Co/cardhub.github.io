# Recommended Folder Layout

```
my-site/
  index.html            ← homepage (quick links)
  styles.css            ← shared styling
  main.js               ← shared JS (theme/year)
  assets/
    favicon.svg         ← shared icon
  yugioh/
    index.html          ← YGO landing
    data/               ← YGO json/decks/etc.
    assets/             ← YGO images
    js/                 ← YGO scripts
  mtg/
    index.html
    data/
    assets/
    js/
  pokemon/
    index.html
    data/
    assets/
    js/
```

## Why this layout?
- **Scales cleanly** as each game grows (decks, rules, pages).
- **Shared** CSS/JS live at the root; game-specific stuff stays inside each folder.
- Clear, predictable **relative paths**:
  - From `yugioh/index.html` back to root files: `../styles.css`, `../main.js`, `../index.html`

## Linking examples
In `yugioh/index.html`:
```html
<link rel="stylesheet" href="../styles.css">
<script src="../main.js" defer></script>
<a href="../index.html">← Home</a>
```

Place game-specific JSON like `yugioh/data/decks.json`, and images in `yugioh/assets/`.
