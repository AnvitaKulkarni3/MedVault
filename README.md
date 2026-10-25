# MedVault

MedVault is a full-stack patient health organization portal based on the supplied project specification. It includes patient accounts, private health entries, medication stock/reminder tracking, appointments, expenses, diet/grocery planning, doctor notes, prescription image OCR drafts, and a role-protected admin console.

> MedVault is an organizational tool, not a diagnostic system or a replacement for professional medical advice. OCR is fallible. Always compare extracted text with the source and ask a clinician or pharmacist when unsure.

## Requirements

- Node.js 20.19 or newer (or Node.js 22.12 or newer)
- MongoDB Community Server running locally, or a MongoDB connection string
- npm

## Start in development

1. Open a terminal in this folder.
2. Install dependencies:

   ```sh
   npm install
   ```

3. Copy `.env.example` to `.env` and set a unique `JWT_SECRET` with at least 32 characters. Set `MONGODB_URI` if your MongoDB instance is not at the default local address.
4. To provision the first admin, configure both `ADMIN_EMAIL` and `ADMIN_PASSWORD` (minimum 12 characters) before starting the server. Registration from the app always creates a patient account.
5. Start the API and frontend:

   ```sh
   npm run dev
   ```

6. Open [http://localhost:5173](http://localhost:5173). The API runs at [http://localhost:4000](http://localhost:4000).

For production, run `npm run build`, set `NODE_ENV=production`, and run `npm start`. Express serves the built frontend. Configure HTTPS and a trusted MongoDB deployment before exposing the app to the internet.

## Included functionality

- Patient registration and sign-in with password hashing, HttpOnly session cookie, account status checks, and rate-limited authentication.
- Patient-owned records, medication entries, appointments, expenses, meal-plan notes, doctor notes, and grocery items stored in MongoDB.
- Dashboard summaries, upcoming appointments, medication stock threshold flags, and saved-expense totals.
- Prescription image upload for JPG/PNG up to 8 MB. The server validates image signatures and stores files under a private, non-public directory. Tesseract creates candidate text lines for user review; OCR text is not written to general logs.
- Original prescription images are served only through an authenticated, owner-scoped endpoint.
- A prescription must be manually reviewed and explicitly confirmed before medication entries are created. Reminders are off by default and require a separate user action.
- Admin overview and account operations expose only account metadata and aggregate OCR counts, never health records, OCR text, medication lists, or expenses. Account status changes are written to an audit log.
- Responsive interface for desktop and mobile.

## Notes and limitations

- The OCR demonstration uses Tesseract.js with English language data and is intended for reasonably clear printed text. Handwriting and complex prescription layouts may not be recognized correctly. Candidate lines are not medical instructions; verify all data.
- Medication reminders are an in-app preference flag. This MVP does not deliver notifications while the browser is closed and does not run scheduled reminder jobs.
- Appointment recurrence is recorded as a user-selected plan; recurring event expansion and exceptions are not implemented in this MVP.
- Receipt/document uploads other than prescription images, email/SMS notifications, caregiver access, and production object storage are not included.
- This starter project does not claim regulatory compliance. Use synthetic information for demonstrations and conduct a privacy/security review before any real deployment.

## Data and privacy

MongoDB stores account and patient-owned entry data. Private OCR source images are stored in `server/private_uploads/`, which is excluded from version control and not mounted as static content. Keep `.env` and all private uploads out of backups or artifacts shared without authorization. Use TLS in deployment, restrict database access, rotate secrets, and establish retention/backup policies.

Admin routes use server-side role checks and safe account projections. Do not add health details to admin DTOs, audit logs, or general request logs.

## API outline

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Register a patient |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | End the session |
| GET | `/api/auth/me` | Current user |
| GET | `/api/dashboard` | Patient-owned dashboard summary |
| GET/POST | `/api/entries/:category` | List or create a patient-owned entry |
| PATCH/DELETE | `/api/entries/:category/:id` | Update or delete an owned entry |
| POST | `/api/prescriptions/scan` | Upload a private image and create an OCR review draft |
| GET | `/api/prescriptions` | List the current patient's prescription drafts |
| GET | `/api/prescriptions/:id/file` | Owner-only view of an original scan |
| POST | `/api/prescriptions/:id/confirm` | Confirm reviewed fields and create inactive medication entries |
| GET | `/api/admin/overview` | Admin-only aggregate metrics |
| GET | `/api/admin/users` | Admin-only permitted account fields |
| PATCH | `/api/admin/users/:id/status` | Admin-only account status change, audited |
| GET | `/api/admin/audit-logs` | Admin-only account administration audit events |

Supported entry categories are `records`, `medications`, `appointments`, `expenses`, `diet`, `notes`, `groceries`, and `dose-logs`.
