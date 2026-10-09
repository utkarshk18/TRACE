# TRACE
**Tamper-Resistant Automated Colorimetric Evaluation**

A Node.js + React companion for existing field test kits. TRACE does not replace the chemical kit. It adds calibrated colour reading (CIELAB), uncertainty-aware results, SHA-256 hashing, Ed25519 signatures, QR verification, and an offline-first audit trail.

TRACE supports **presumptive** field-test interpretation and evidence documentation. Confirmatory laboratory analysis remains authoritative.

Demo outputs are labelled **SIMULATED DEMO DATA**.

## Stack

- **Frontend:** React 18 (Vite) + React Router
- **Backend:** Node.js, Express
- **Database:** MongoDB
- **Integrity:** SHA-256 + Ed25519 (Node `crypto`)

## Prerequisites

- Node.js 20+
- MongoDB running locally (`mongodb://localhost:27017`) or a MongoDB Atlas URI

## Setup

```bash
# 1. Backend
cd backend
copy .env from the repo root example if needed
npm install
npm run dev
```

The API starts on `http://localhost:8000` and seeds demo users/evidence if the database is empty.

If the default local MongoDB is not running, the API falls back to an **in-memory MongoDB** for the session so the demo still starts. Remote connection failures (including Atlas authentication or network-access errors) are reported and stop startup; they do not fall back to temporary storage. If the system DNS resolver refuses an Atlas SRV lookup, the backend retries it using `MONGODB_DNS_FALLBACK_SERVERS` (Cloudflare and Google DNS by default). Set this variable to comma-separated DNS server IPs appropriate for your network, or leave it empty to disable fallback.

For MongoDB Atlas, set `DATABASE_URL` in `backend/.env` to the full connection URI from Atlas, for example:

```
DATABASE_URL=mongodb+srv://<database-user>:<url-encoded-password>@<cluster-host>/trace?retryWrites=true&w=majority
```

Replace every placeholder in the URI with actual cluster and MongoDB database-user values; do not leave the `<...>` brackets in place. Use a MongoDB database user, not your Atlas website login. URL-encode special characters in the password, and ensure the backend's IP is allowed in the Atlas Network Access list. The backend reads the URI from `DATABASE_URL`; separate username/password variables are not used.

```bash
# 2. Frontend
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Demo accounts

Password for all: `TraceDemo!2026`

| Role | Email |
| --- | --- |
| Field officer | `officer@trace.demo` |
| Supervisor | `supervisor@trace.demo` |
| Admin | `admin@trace.demo` |

## Demo storyline (~2 minutes)

1. Sign in as officer  
2. Command dashboard  
3. Start new test → Demo scenario (Positive / Negative / Inconclusive / Poor capture)  
4. Capture → quality gate → CIELAB calibration → staged analysis  
5. Result + hash + signature  
6. QR → Evidence vault → Verify desk → Audit trail  

## Environment

See `.env.example`. Copy values into `backend/.env` and `frontend/.env`.

```
DATABASE_URL=mongodb://localhost:27017
MONGODB_DB=trace
JWT_SECRET=change-me
SIGNING_PRIVATE_KEY=
SIGNING_PUBLIC_KEY=
VITE_API_URL=http://localhost:8000
```

Leave signing keys empty in demo mode. TRACE generates an Ed25519 keypair at process start (not for production custody).

## API (selected)

- `POST /auth/login`
- `POST /tests`
- `POST /tests/:id/capture`
- `POST /tests/:id/analyze`
- `GET /evidence`
- `GET /evidence/:id`
- `POST /evidence/:id/verify`
- `POST /verify`
- `GET /audit/:evidenceId`

## Honesty constraints

- Inconclusive is returned when confidence is below the profile threshold.
- Verification endpoints only report VALID when hash recomputation and Ed25519 verification both succeed.
- Demo profiles are synthetic. They are not validated forensic colour thresholds.
