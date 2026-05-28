<div align="center">

<img src="extension/icons/icon128.png" width="80" alt="Presence Discord" />

# Presence Discord

**Affiche automatiquement ce que tu regardes sur ton profil Discord.**  
YouTube · Twitch · Plex · Cinepulse · Nakastream · Prime Video

[![Version](https://img.shields.io/badge/version-1.0.0-blueviolet?style=flat-square)](https://github.com/q-kimi/presence-discord/releases)
[![Manifest](https://img.shields.io/badge/manifest-v3-blue?style=flat-square)](#)
[![Platform](https://img.shields.io/badge/platform-Windows-0078d4?style=flat-square)](#)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

</div>

---

## Comment ça marche

```
Navigateur (Chrome)          Compagnon (tray)            Discord
────────────────────         ─────────────────           ────────────
Extension MV3                Electron app                Rich Presence
content script      ──WS──▶  ws://127.0.0.1:47842  ──▶  profil mis à jour
détecte la lecture           enrichit via TMDB
(titre, durée, cover)        et pousse à Discord IPC
```

L'extension détecte la lecture sur les plateformes supportées et envoie un payload au compagnon local via WebSocket. Le compagnon enrichit les métadonnées (pochettes, titres d'épisodes via TMDB) et les transmet à Discord via Rich Presence IPC.

**Tout est local.** Aucun serveur tiers, aucune donnée envoyée à l'extérieur.

---

## Prérequis

- Windows 10 / 11 (x64)
- Google Chrome ou navigateur Chromium
- Discord desktop ouvert

---

## Installation

### 1. Compagnon

1. Télécharge `Presence-Discord.exe` depuis la [page Releases](https://github.com/q-kimi/presence-discord/releases)
2. Lance le `.exe` — aucune installation, aucun administrateur requis
3. L'icône apparaît dans la barre système
4. **Clic droit → Démarrage automatique** pour le lancer avec Windows

> Le compagnon doit rester actif en arrière-plan.

### 2. Extension Chrome

**Via le Chrome Web Store** *(recommandé)*
> Lien disponible dès la validation Google.

**Manuellement (mode développeur)**

1. Ouvre `chrome://extensions`
2. Active le **Mode développeur** (en haut à droite)
3. Clique **Charger l'extension non empaquetée**
4. Sélectionne le dossier `extension/`

### 3. Vérification

- La popup de l'extension affiche **●** vert → WebSocket connecté
- Lance une vidéo sur une plateforme supportée → la présence apparaît sur Discord

---

## Plateformes supportées

| Plateforme    | Présence | Cover | Titre / Épisode | Progression |
|---------------|:--------:|:-----:|:---------------:|:-----------:|
| YouTube       | ✓ | ✓ | ✓ | ✓ |
| Twitch        | ✓ | ✓ | ✓ | — |
| Plex          | ✓ | ✓ | ✓ | ✓ |
| Cinepulse     | ✓ | ✓ | ✓ | ✓ |
| Nakastream    | ✓ | ✓ | ✓ | ✓ |
| Prime Video   | ✓ | ✓ | ✓ | ✓ |

---

## Configuration

La popup de l'extension (onglet **Réglages**) permet d'activer ou désactiver chaque plateforme indépendamment.

Le compagnon lit `companion/.env` au démarrage pour surcharger les valeurs par défaut :

```env
# Optionnel — remplace l'application Discord utilisée pour la Rich Presence
DISCORD_CLIENT_ID=ton_client_id

# Optionnel — remplace la clé TMDB pour les pochettes et titres d'épisodes
TMDB_API_KEY=ta_clé_tmdb
```

Voir `companion/.env.example` pour le détail.

---

## Build depuis les sources

**Prérequis :** Node.js ≥ 18, npm ≥ 9

```bash
# Installer les dépendances
cd companion && npm install

# Lancer en mode développement (sans build)
npm run dev

# Compiler le .exe portable
npm run build
# → dist/Presence-Discord.exe
```

**Empaqueter l'extension pour le Chrome Web Store**

```powershell
Compress-Archive -Path extension\* -DestinationPath extension.zip
```

---

## Site web

Le site (`web/`) est un fichier HTML statique servi par nginx:alpine, déployé sur [Railway](https://railway.app).

```bash
cd web
railway up --detach
```

> Configurer **Root Directory = `web`** dans le Railway Dashboard.  
> Healthcheck : `GET /health` → `200 ok`

---

## Structure du projet

```
Presence-Discord/
├── extension/              # Extension Chrome (Manifest V3)
│   ├── manifest.json
│   ├── background.js       # Service worker — WebSocket, queue, heartbeat
│   ├── content.js          # Détection lecture par plateforme
│   ├── popup.html / .js    # Interface popup
│   └── icons/
│
├── companion/              # Application Electron (system tray)
│   ├── main.js             # Fenêtre, tray, IPC, notifications
│   ├── core.js             # WebSocket server, Discord RPC, enrichissement TMDB
│   ├── preload.js          # Bridge contextIsolation
│   ├── ui.html             # Interface compagnon
│   ├── build/              # Icônes (ico, png)
│   ├── config.json         # Configuration par défaut
│   └── .env.example        # Variables d'environnement optionnelles
│
├── web/                    # Site web (Railway)
│   ├── index.html
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── entrypoint.sh
│   └── railway.json
│
├── dist/                   # Généré par electron-builder (gitignore)
├── package.json            # Scripts racine : dev, build
└── .gitignore
```

---

## Licence

[MIT](LICENSE) — © 2026 [q-kimi](https://github.com/q-kimi)
