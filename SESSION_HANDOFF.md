# IELTS OS — Session Handoff (cập nhật 2026-09-07)

## AI raw-DOCX batch and delivery-mode rules — 2026-09-09

- `deliveryMode` is authoritative. Missing/ambiguous legacy data means **Exam**, never Practice. Practice is explicit and materializes unlimited attempts plus disabled integrity/audio restrictions without erasing the remembered Exam policy.
- Never trust a browser role for bulk conversion, publication, raw-DOCX processing or generated-document download. Firebase Admin verifies the bearer token; `EXAM_MANAGER_EMAILS`/`TEACHER_EMAILS` is the server allow-list.
- Raw-DOCX batch state, uploads, generated DOCX, parser payloads and managed media now use Firestore plus Firebase Storage through `api/exam_generation_durable.py`; no production batch route may create `.exam-generation` or rely on `EXAM_GENERATION_STATE_DIR`. A Vercel invocation uses `/tmp` only as disposable scratch after a Firestore lease has been claimed, then persists every artifact before it marks the file terminal.
- `POST /api/exam-generation/batches/{id}/advance` is a lease-safe fast-path: it claims at most two global worker slots, then starts a best-effort background worker. `BackgroundTasks` is never authoritative; an expired lease may be resumed safely by a later browser/worker call. Keep stage and question heartbeats updating the lease. Do not replace this with an unleased filesystem worker.
- `vercel.json` allows `api/index.py` 300 seconds. Keep this bounded; a job that outlives the invocation must remain resumable from Firebase, never be marked complete only in memory.
- Every bulk record update increments `revision`, writes bounded audit data, accepts an idempotency key and isolates failure per record. Do not use client-side fan-out writes for mode/publish actions.
- AI DOCX import is fail-closed: preserve OOXML images through hash-bound extraction/re-embedding, use direct `api.index.parse_docx_to_quiz` for the final round-trip, and never publish when validation, grounding, repair, parser or media verification is incomplete.
- Generated batch responses must never expose absolute filesystem paths. Serve output only from an authenticated, path-confined download route.
- `api/requirements.txt` and the workspace `.venv` must include `firebase-admin`. VS Code should select `.venv\\Scripts\\python.exe`; otherwise Pylance reports Firebase imports as missing even though production is correctly configured.
- Firebase Admin must be initialized before `verify_id_token`; do not assume Firestore work runs first. In Vercel Production, `EXAM_MANAGER_EMAILS` is mandatory and must contain the exact comma-separated Firebase teacher emails. An empty list intentionally returns 503; client error handling must show FastAPI `detail` rather than masking configuration failures as a generic AI error.
- `firebase_admin.storage.bucket(name=FIREBASE_STORAGE_BUCKET, app=...)` is required for raw-DOCX jobs. The service account needs Firestore read/write and Storage object read/create/update/delete. Use `EXAM_GENERATION_MEDIA_BASE_URL` for a canonical HTTPS media origin; a trusted current production origin is a fallback only.
- `STORAGE_BUCKET_NOT_FOUND` is a deployment/configuration diagnosis, not a DOCX failure: the Firebase project must have an actual Storage bucket provisioned and Vercel must use that exact bucket name. Do not replace durable Storage with Vercel disk or silently accept a non-durable fallback.
- Firestore transactions must run through `firebase_firestore.transactional`; direct `DocumentReference.get(transaction=database.transaction())` is invalid with current Admin SDK clients and causes `Transaction not in progress`. This affected bulk publish/unpublish and retention; never manually call `transaction.commit()` around a direct unstarted read.
- A Firebase service-account private key was exposed outside the repository. Rotate that key in Google Cloud/Firebase and replace only the encrypted Vercel `FIREBASE_SERVICE_ACCOUNT_JSON`; never commit or paste a replacement into source/chat.

## Annotation layers and shared answer dragging — 2026-09-09

- `src/annotationLayers.ts` persists semantic annotation wrappers using `data-annotation-id/type/start/end/created` and existing `data-note/data-note-id`. One action shares one ID across its text fragments. Legacy wrappers receive deterministic IDs, preserving existing note IDs. Leaf paint segments are rebuilt from distinct active highlight IDs; never treat stored pink as semantic data. Serialization and sanitized rendering rebuild segments; note mutation must also call `annotationHTML` so obsolete paint disappears. Keep `syncHighlightState` mirroring section/questions intact.
- Highlight deletion removes all fragments of the selected newest ID, not all intersecting annotations. Note wrappers remain independently editable in the sidebar. Single-highlight colours still use `--hlbg/--hlfg`; overlaps always use pink/black. Do not reintroduce a ban on selecting already-highlighted text.
- `src/answerDrag.ts` holds only transient native drag presentation/scope; assignment persistence remains the existing `examAnswers` autosave path. All active question groups expose stable question IDs for drop validation. Shared capture handlers handle return-to-bank and cancellation; heading payload IDs remain separate from generic answer text. No deploy/cache/audio changes.
- The user's explicit instruction supersedes the attached DnD brief's used-placeholder rule: sources fade during drag, then used non-reusable bank options disappear after a valid drop. Invalid drops never clear assignments. Do not hide a bank option on drag start.
- `observeSentenceEnding` measures actual label widths and wrapped heights, updates CSS variables via ResizeObserver, and cleans up its observer/probe when unmounted. Do not restore a character-count estimate or a filled-slot fixed-height clip.
- Browser regression scripts: `tests/test_annotation_layers_browser.py` (27 range/theme/deletion cases plus legacy/reload) and `tests/test_answer_drag_browser.py` (native drag fixtures for six renderer classes, source ghost/cancel, invalid group, move/replace/return and measured desktop/narrow slot geometry). Run against Vite port 5173 with Python Playwright. These are local shared-engine fixtures, not authenticated production-session or physical-touch-device QA.

## Infrastructure update 2026-09-07

## Performance and DOCX import update 2026-09-08

### Startup performance

- `three` is no longer a runtime import in the initial app bundle. `SevererScene` dynamically loads it only when the student opens the Threads/Vocab game. Measured initial JavaScript fell from 2,174,622 B to 1,643,262 B raw (584,606 B to 452,767 B gzip). Do not restore a top-level `import * as THREE` for a feature that is not needed in the Test Room.
- Listening keeps native `<audio preload="metadata">`. While an active Listening/Integrated test is on its instruction screen, the client may issue exactly one same-origin `Range: bytes=0-262143` prewarm per audio URL, with a 4.5-second abort, Data Saver/2G opt-out, and no `play()`, `load()`, timer, service-worker, or cache-policy change. This warms the Vercel/Firebase proxy path without downloading a full recording.
- The audio proxy and service worker must continue to bypass media/Range caching. A short prewarm is not authorization to cache or buffer entire recordings in Cache Storage.

### DOCX batch safety

- The ordinary Exam Builder upload button now reuses `/api/upload_docx_batch` for up to 20 files. It renders a per-file review and requires an explicit “add valid exams” confirmation; partial parser failures do not block the valid subset.
- Capture the destination folder when files are chosen. Before the one catalog upsert, rekey imported quiz, question, and Writing-task IDs with a collision-safe quiz ID. Do not loop `saveQuiz()` for a batch or send the entire catalog through the old `quizzes` payload.
- `[TYPE] Writing` is parser-supported only through two ordered `[WRITING_TASK 1]` / `[WRITING_TASK 2]` blocks with non-empty `[PROMPT]`; optional chart media is a public HTTPS `[MEDIA]` URL. Embedded DOCX images remain unsupported. The complete grammar is in `DOCX_FORMATTER_PLAYBOOK.md`.

### Writing feedback compatibility

- Writing comments may include optional `startOffset` / `endOffset` (JavaScript string offsets) alongside `anchorQuote`. Preserve these fields when syncing grades; they distinguish repeated passages. Older quote-only comments remain supported, using the first matching occurrence.
- Review and grading now share `src/WritingFeedback.tsx`: select essay text to comment, click a highlighted passage to locate feedback. Student feedback remains hidden until publication; save/publish behavior is unchanged.

### Retention job

- Vercel Cron invokes `GET /api/maintenance/cleanup_attempts` daily at 03:00. The endpoint accepts only `Authorization: Bearer <CRON_SECRET>`; it is not a public delete route.
- The job uses Firebase Admin and `FIREBASE_SERVICE_ACCOUNT_JSON`. Missing dependencies or credentials produce a safe error with no deletion. Configure both that value and `CRON_SECRET` in Vercel before deploy.
- Retention: ordinary attempts expire 30 days from `submittedAt`; Writing drafts expire at `expiresAt`; Writing results expire only 30 days after `writingGrading.publishedAt`. Awaiting-grade and draft Writing work is retained.
- Never move retention authority into the browser or place a service account in frontend code.

Đọc file này TRƯỚC khi làm bất cứ gì trong repo `ielts-timer-pro`. Nó ghi lại toàn bộ thay đổi của phiên làm việc gần nhất và các luật bất di bất dịch rút ra từ đó — vi phạm là tái phát bug đã fix.

## Đọc thêm bắt buộc

- `CLAUDE.md` — quy tắc build cốt lõi: **`src/App.tsx` là file TỰ SINH** (`python compile_app.py` ráp từ `src/App.template.tsx` + `src/components_split/*.txt`). **KHÔNG BAO GIỜ sửa `App.tsx` trực tiếp** — mọi sửa đổi phải vào `App.template.tsx` hoặc file `.txt` tương ứng trong `components_split/`, rồi chạy lại `python compile_app.py`.
- Sau mỗi lần sửa: `python compile_app.py && npx tsc -b` (phải EXIT 0) trước khi báo hoàn thành. `npm run build` để kiểm production thật sự cần thiết.
- **CẢNH BÁO**: `npx tsc --noEmit` (không có `-b`) là lệnh VÔ DỤNG ở repo này — tsconfig.json gốc có `"files": []` nên nó không check file nào cả, luôn EXIT 0 giả. Đã từng khiến lỗi cú pháp lọt qua "kiểm tra" và IDE hiện 300+ lỗi. PHẢI dùng `npx tsc -b`.
- KHÔNG BAO GIỜ đặt comment `{/* */}` ngay sau `&& (` trong JSX (vị trí biểu thức) — chỉ đặt trong phần children. Lỗi này từng làm vỡ cú pháp cả App.tsx.

## Việc đã làm trong phiên này (theo thứ tự)

1. **Đại tu UI Listening/Reading (ACTIVE_EXAM.txt)** — chuẩn IDP/BC:
   - Dạng kéo-thả (matching A–G, theorist…): chuẩn hoá layout 2 cột — **mục + ô trống bên TRÁI, kho tag bên PHẢI** (đúng chuẩn IDP, không phải ngược lại). Tag dùng 1 lần thì biến mất khỏi kho; nếu số câu > số tag (nhiều câu cùng đáp án) thì tag **giữ lại, dùng nhiều lần** — logic `reuseTags = questions.length > options.length`.
   - Ô input/dropzone **co giãn theo độ dài đáp án DÀI NHẤT trong nhóm** (không phải trung bình) + nới thêm biên. Đáp án đa biến thể kiểu `"July 18/18 July/18th July"` chỉ tính **1 biến thể dài nhất** khi đo độ dài (tách theo `/`).
   - Bảng (table completion): KHÔNG được ép xuống dòng từng ký tự (nhìn gớm). Dùng **container query** (`container-type: inline-size` trên `.idp-context-box`) để tự thu nhỏ font/padding/input-width khi cột hẹp lại — 2 breakpoint 760px/600px.
   - `.exam-question-col` / `.exam-passage-col` phải có `min-width: 0` — nếu không, bảng/nội dung to sẽ **chặn cứng splitter**, kéo không nhúc nhích.
   - Splitter giữa 2 cột: sao chép style Inspera (rãnh xám mảnh + nút vuông ↔ ở giữa), vùng bắt chuột rộng ra để dễ trúng.
   - Popup bôi đen (Note/Highlight) và nút Notes trên top bar: sao chép icon/layout Inspera chính xác theo ảnh mẫu user gửi.
   - Panel Notes bên phải: item **hover là đổi nền xanh ngay** (không phải chỉ khi bấm Delete).
   - Nút điều hướng câu (mũi tên) và nút Submit: vuông góc, khít nhau, không bo tròn thừa.
   - Màn hình chờ audio: sao chép pixel-perfect giao diện Inspera thật (icon tai nghe SVG, không dùng emoji).

2. **BUG NGHIÊM TRỌNG — mất dữ liệu vocabNotebook của học sinh (250→22 từ)**
   - Nguyên nhân: `syncData()` (App.template.tsx) merge Firestore theo kiểu "server thắng" cho giáo viên nhưng không có luật riêng cho `vocabNotebook` → giáo viên ghi đè (dù vô tình, qua bất kỳ hành động nào kích hoạt `syncData`) sẽ xoá sổ từ vựng học sinh vừa tạo.
   - Fix: `vocabNotebook` giờ **union theo `id` của từ** (không bao giờ ghi đè cứng) + thêm field `vocabTombstones` (mảng id đã xoá) để phân biệt "chưa có" với "đã xoá chủ động" — tránh từ bị xoá tự động sống lại sau union.
   - **LUẬT BẤT DI BẤT DỊCH**: bất kỳ field nào lưu dữ liệu do HỌC SINH tự tạo (không phải giáo viên cấu hình) → PHẢI merge theo kiểu union/tombstone, KHÔNG BAO GIỜ để giáo viên/admin ghi đè toàn bộ mảng.

3. **BUG NGHIÊM TRỌNG — mất Highlight/Note khi chuyển Passage/Section**
   - Nguyên nhân: có **2 bản hàm `syncHighlightState` trùng tên** trong codebase (1 ở App.template.tsx thân component, 1 lặp lại trong file render cũ) — bản đang thực sự được gọi **thiếu nhánh xử lý `sections`**, và **không đồng bộ ngược vào `activeExam.sections[].questions`** sau khi cập nhật `activeExam.questions`. Kết quả: quét/note trong bài đọc bị ném vào hư không khi có `sections` (multi-passage/multi-section), và dấu quét biến mất khi chuyển qua lại giữa các section dù data trong tab Notes vẫn còn.
   - Fix: hợp nhất thành **MỘT bản canonical duy nhất** trong `App.template.tsx`, có đầy đủ nhánh `sections`, luôn ghi đồng bộ cả `activeExam.questions` VÀ `activeExam.sections[].questions`. Xoá bản trùng lặp trong ACTIVE_EXAM.txt.
   - **LUẬT BẤT DI BẤT DỊCH**: Trước khi sửa bug "mất dữ liệu / mất trạng thái ngẫu nhiên", luôn `grep` toàn repo tìm hàm/biến TRÙNG TÊN — codebase này có lịch sử patch chồng patch để lại nhiều bản sao lệch pha nhau. Đừng chỉ sửa bản đầu tiên tìm thấy.

4. **BUG — Audio bị đứt sau ~5 giây khi thi Listening (desktop, cả preview lẫn thi thật)**
   - Nguyên nhân: `public/sw.js` (service worker) cache-first mọi request GET, kể cả audio stream phát bằng HTTP Range request — cache trả sai/cụt khúc dữ liệu khiến trình duyệt tưởng hết audio.
   - Fix: sw.js bỏ qua hoàn toàn (network passthrough) mọi request có header `Range`, hoặc đuôi file audio/video (`.mp3 .m4a .wav .ogg .mp4 .webm`...). Bump `CACHE_VERSION` để buộc client tải service worker mới.
   - **LUẬT BẤT DI BẤT DỊCH**: service worker cache-first KHÔNG BAO GIỜ được đụng vào request phát trực tuyến (audio/video) — luôn bypass Range requests.

5. **AI Vocab Extraction — nâng cấp độ chính xác phân loại**
   - Backend (`api/index.py`): siết lại rule phân loại 5 nhóm (single word / phrasal verb / collocation / idiom / fixed expression) — sửa các case bị nhầm lẫn giữa collocation và phrasal verb, đảm bảo mỗi từ trích ra có category đúng nghĩa học thuật.

6. **AI Explain trong Review — timestamp Listening**
   - Thêm cơ chế: khi giải thích đáp án cho câu Listening, AI trả về kèm `[MM:SS]` trỏ đúng vị trí trong audio → FE hiển thị nút bấm để tua audio tới đúng giây đó, hỗ trợ học sinh nghe lại đoạn liên quan.
   - Đã sửa lỗi timestamp lệch vị trí thực tế trong audio.

7. **Dashboard giáo viên — redesign**
   - Áp dụng phong cách "Manuscript" nhất quán với `design-taste-exam-builder` đã có sẵn trong dự án (xem token `EB` trong EXAM_BUILDER.txt) — bỏ card lồng card, dùng khoảng trắng + hairline + accent bar dọc, font Fraunces/Space Grotesk/Inter/Space Mono.

8. **Loại bỏ toàn bộ emoji trong UI** → thay bằng SVG icon nội bộ (đã có sẵn hệ icon SVG trong project, xem cách dùng trong `components_split/`). Không dùng emoji cho bất kỳ UI element nào nữa (nút, label, badge...).

## Quy tắc làm việc với user (rút ra từ phiên này)

- User là giáo viên IELTS, KHÔNG rành kỹ thuật — luôn giải thích ngắn gọn, không thuật ngữ thừa, ưu tiên xong việc hơn là dài dòng.
- User giao tiếp kiểu "caveman" (câu ngắn, trực tiếp) — đáp lại tương xứng, không lan man.
- User **rất khó chịu với UI "trông giống AI làm"** — luôn tham khảo `design-taste-exam-builder` memory/skill trước khi động vào bất kỳ UI nào. Ưu tiên phong cách Manuscript/Editorial nhất quán toàn app.
- User yêu cầu **dùng skill phù hợp** trước khi thực hiện task lớn (frontend-design, redesign-existing-projects, v.v. đã cài trong `.agents/` hoặc plugin marketplace) — kiểm tra danh sách skill khả dụng trước khi bắt tay code UI.
- Khi user báo "lỗi X" mà nghe giống bug tái diễn/ngẫu nhiên → nghi ngờ ngay: (a) hàm trùng tên/logic trùng lặp lệch pha, (b) service worker/cache, (c) merge logic Firestore thiếu field mới. Đây là 3 nguồn lỗi đã xác nhận lặp lại trong dự án này.
- Luôn build + typecheck (`compile_app.py` + `npx tsc -b`) trước khi báo "xong" — không suy đoán compile thành công.

## File/thư mục quan trọng cần biết

- `src/App.template.tsx` — nguồn thật của component chính, chứa toàn bộ state, hooks, hàm logic dùng chung (syncData, syncHighlightState, v.v.)
- `src/components_split/*.txt` — từng khối UI lớn được tách riêng (ACTIVE_EXAM, EXAM_BUILDER, DASHBOARD...) rồi compile_app.py ráp vào App.template.tsx đúng vị trí đánh dấu.
- `api/index.py` — backend FastAPI (AI vocab, AI explain, v.v.)
- `public/sw.js` — service worker, đã có bài học đau về audio caching, cẩn thận khi sửa.
- `compile_app.py` — script ráp file, PHẢI chạy sau mọi thay đổi ở template/components_split.

## Cập nhật hạ tầng 2026-08-31

### Video hướng dẫn kỳ thi thật

- Không phát trực tiếp hai video hướng dẫn từ `cdn.videotourl.net`. Host này đã đo được độ trễ kết nối/TTFB nhiều giây, response không có cache policy rõ ràng và có lúc reset request tải đoạn.
- Bản gốc không cắt xén được lưu tại `public/instruction-videos/` với tên có version:
  - `listening-tutorial-v1.mp4`
  - `reading-tutorial-v1.mp4`
- Không dùng hai bản `v1` trên production: Chromium có thể giữ chúng ở `networkState=loading`, không trả metadata dù HTTP Range hợp lệ. Production dùng `listening-tutorial-v2.mp4` và `reading-tutorial-v2.mp4`: H.264 High@L3.1, yuv420p, 1280×720, 30fps, `faststart`; Listening giảm 11.6 MB → 5.2 MB, Reading giảm 20.4 MB → 10.2 MB. Giữ `v1` nguyên vẹn, đổi URL thay vì ghi đè vì cache một năm.
- Writing dùng `writing-tutorial-v1.mp4`: H.264/AAC 720p, đã cắt chính xác 60 giây và `faststart` để mở đầu phát nhanh. Đây là URL chung cho mọi Writing trong gói thi thật; không lưu hoặc cấu hình URL theo từng đề trong Exam Builder.
- `vercel.json` đặt `Cache-Control: public, max-age=31536000, immutable` cho `/instruction-videos/*`. Khi thay nội dung video phải tăng hậu tố version và cập nhật URL trong `officialInstructionVideoUrl`; không ghi đè file cùng tên vì client có thể giữ cache một năm.
- Màn tổng hợp kỳ thi thật mount một video ẩn `preload="auto"` cho đúng bài kế tiếp. Khi học sinh bấm Start, video hiển thị dùng lại tài nguyên đã được browser/CDN làm ấm thay vì bắt đầu kết nối từ số 0.
- Service worker vẫn phải bypass toàn bộ media và Range request. Cache tutorial video do browser/Vercel HTTP cache xử lý, không đưa vào Cache Storage của `public/sw.js`.

### Kỷ luật tài liệu

- Feature hoặc hành vi mới của web: cập nhật `README.md` trong cùng thay đổi.
- Hạ tầng, deploy, cache, storage, build hoặc quy chuẩn làm việc mới: cập nhật `SESSION_HANDOFF.md` trong cùng thay đổi.
- Backend, API, parser hoặc quy trình bóc/tạo DOCX mới: cập nhật `DOCX_FORMATTER_PLAYBOOK.md` trong cùng thay đổi.
- Các luật trên cũng được ghi trong `AGENTS.md`; không commit hoặc báo hoàn thành khi tài liệu thuộc phạm vi chưa đồng bộ.
