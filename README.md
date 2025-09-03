# 🃏 Card Hub

**Card Hub** is a personal trading card game website designed to organize, showcase, and explore decks for multiple games including:

- **Yu-Gi-Oh!**
- **Magic: The Gathering (MTG)**
- **Pokémon TCG**

It provides quick links, interactive deck views, and a unified hub for managing card resources in a clean and accessible way.

---

## ✨ Features

- 🎴 **Deck Showcase** – Display card lists by deck with images, counts, and metadata.
- 📂 **Deck Sections** – Main, Extra, and Side Decks are separated and collapsible.
- 🧭 **Multi-Game Navigation** – Jump between Yu-Gi-Oh!, MTG, and Pokémon sections.
- 🌙 **Theme Toggle** – Switch between dark/light themes.
- 🦇 **Loading Screen** – Custom bat animation during page load.
- 🔍 **Lightbox Viewer** – Click on any card to zoom in and browse through cards in a gallery view.

---

## 🛠️ Built With

This project is built with **vanilla web technologies** for speed and simplicity:

- **HTML5** – Semantic, accessible structure
- **CSS3** – Custom themes, gradients, responsive layouts
- **JavaScript (ES6)** – Deck loading, dynamic rendering, and interactivity
- **JSON** – Deck data format

No frameworks are required — just a modern browser.

---

## 📂 Project Structure

CardHub/
│
├── index.html # Homepage with hero banner + game links
├── styles.css # Global site styles
├── main.js # Shared JavaScript (theme toggle, utilities)
│
├── yugioh/ # Yu-Gi-Oh! section
│ ├── index.html
│ ├── js/vampire.js # Yu-Gi-Oh! deck rendering logic
│ ├── data/ # Deck JSON files
│ └── assets/ # Card backs, hero banners, etc.
│
├── mtg/ # MTG section
├── pokemon/ # Pokémon section
│
└── assets/ # Shared assets (logo, loader, fonts)


---

## 🚀 Getting Started

1. Clone or download this repository.
2. Open `index.html` in a browser (or host via GitHub Pages).
3. Navigate to a game section and choose a deck to load.

---

## 📜 License

This project is for **personal and educational use only**.  
It is not affiliated with Konami, Wizards of the Coast, or The Pokémon Company.

---

## 🙌 Acknowledgements

- Yu-Gi-Oh! card images from [YGOPRODeck](https://ygoprodeck.com/).
- Inspiration from the TCG communities that keep these games alive!
