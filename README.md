# FRIDAY — AI Assistant Skeleton

```
friday/
├── backend/
│   ├── intentParser.js   # text → intent JSON
│   ├── executor.js       # intent → mock action
│   ├── server.js         # Express (port 3131)
│   └── package.json
└── desktop/
    ├── src/
    │   ├── main.js       # Electron main process
    │   ├── preload.js    # IPC bridge
    │   └── overlay.html  # Orb UI
    └── package.json
```

## API

| Endpoint      | Body          | Returns                        |
|---------------|---------------|--------------------------------|
| POST /chat    | `{ text }`    | `{ intent }`                   |
| POST /execute | `{ text }`    | `{ intent, result }`           |

### Supported intents (extend in `intentParser.js`)
- `open <app>`
- `search <query>`
- `remind me <task>`
- `weather [in <location>]`
- `time`

## Setup

```bash
# 1. Backend
cd friday/backend
npm install
node server.js

# 2. Desktop (new terminal)
cd friday/desktop
npm install
npx electron .
```

## Extending

- **New intent**: add a pattern to `intentParser.js`
- **Real action**: replace mock in `executor.js`
- **Voice input**: wire Web Speech API → `input` field in `overlay.html`
