## npm run dev kaise chalaye (Vite + Base44)

### 1) Install dependencies
```bash
npm i
```

### 2) Dev server start
```bash
npm run dev
```

### 3) Agar ye warning aaye
`[base44] Proxy not enabled (VITE_BASE44_APP_BASE_URL not set)`

Iska matlab: `VITE_BASE44_APP_BASE_URL` env var set nahi hai.

### 4) Fix: .env file set karein
Project root me `.env` ya `.env.local` banayein:

```env
VITE_BASE44_APP_BASE_URL=http://<your-base44-base-url>
VITE_BASE44_APP_ID=<your-app-id>
VITE_BASE44_FUNCTIONS_VERSION=<your-functions-version>
```

Phir restart:
```bash
npm run dev
```

