## FOIS Backend

This project now includes a small Node.js + Express API.

### Start API

```bash
npm run dev:api
```

API runs on:

```text
http://localhost:3000
```

### Start Frontend

In another terminal:

```bash
npm run dev
```

Frontend runs on:

```text
http://localhost:5173
```

Vite proxies `/api` requests to `http://localhost:3000`, using the existing
`VITE_BASE44_APP_BASE_URL` value in `.env`.

### Current Storage

The backend currently stores records in:

```text
server/data/db.json
```

That file is ignored by git. It is useful for local development and client demos.
For production, replace this JSON store with PostgreSQL or MySQL.

### Main Entity APIs

```text
GET    /api/entities/FreightMovement
POST   /api/entities/FreightMovement
PATCH  /api/entities/FreightMovement/:id
DELETE /api/entities/FreightMovement/:id
POST   /api/entities/FreightMovement/bulk
```

The same pattern is available for:

```text
MaturedIndent
UploadLog
RailNotification
UserSettings
RailwayDictionary
```
