# Security And Stability Follow-ups

This file records work intentionally deferred after the 2026-07-28 hardening pass.

## Firestore authorization redesign (highest priority)

The app still stores most shared state in `ielts_workspace/trung_linh_data` and writes it directly from clients. A Firestore rule cannot safely prove that a student changed only their own nested record inside this large document. Do not lock this document down piecemeal: that would break student sync while still leaving integrity gaps.

Required migration:

1. Split the workspace document into teacher-owned class data, per-student records, quiz results, coins, and schedules.
2. Use Firebase Auth UID, not an encoded email address, as every per-student document ID.
3. Apply Firestore rules that allow a student to read/write only their UID path and allow teachers to manage class paths.
4. Move coin awards, purchases, rewards, and review rewards to a trusted server/Cloud Function transaction so clients cannot submit their own balances.
5. Add a versioned `firestore.rules` file and deploy it only after the data migration is verified on a staging project.

## Production controls

- Set `TEACHER_EMAILS` in Vercel to an explicit comma-separated allowlist. The safe compatibility fallback currently accepts managed `@ielts.os` accounts.
- Set `APP_ALLOWED_ORIGINS` if a custom production domain is introduced.
- Enable `API_DOCS_ENABLED=true` only on a protected development environment; public API docs are disabled by default.
- Deploy `storage.rules` with Firebase CLI after confirming every teacher uses a managed `@ielts.os` address. The 2026-07-28 deploy attempt was blocked because Firebase reports that Storage has not been initialized for project `ielts-os`; initialize it in Firebase Console first, then deploy the committed rule file.

## Rate-limit durability

The API now has a per-instance in-memory limiter for expensive AI routes. For cross-instance enforcement, add Vercel KV/Upstash or an equivalent shared limiter before opening the app to a large public user base.

## Dependency maintenance

`npm audit --omit=dev` reported transitive findings through Firebase and ExcelJS plus a direct DOMPurify update. Run a separately tested dependency upgrade, rebuild, and smoke-test login, Firestore listeners, DOCX export, and PDF export before shipping it. Do not run a broad audit fix during a parser/UI task.

## Mobile startup performance

The production build still emits a main JavaScript bundle of about 1.9 MB before gzip. Split heavy teacher-only features such as ExcelJS, HTML-to-PDF, and the 3D/live views with dynamic imports before the next mobile performance pass.
