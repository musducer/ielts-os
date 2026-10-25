# IELTS OS

## Annotation and answer dragging

- Note/Highlight uses custom 64×64 SVG artwork in a compact IELTS-style context toolbar. Each annotation keeps its own ID, type, text offsets, creation time and note content. Two or more highlights paint their intersection pink with black text in all three contrast modes. Single highlights retain the current theme colour; highlights cover note colouring without deleting notes. “Delete Highlight” removes only the top annotation, revealing any underlying highlight/note.
- All interactive answer banks share a move cursor, blue hover/target border, isolated drag preview and faded source during dragging. Per the latest requested behaviour, non-reusable options disappear **only after a valid placement**, and return when dragged back to their bank. Cancellation leaves assignments intact. Used answers can move between gaps in their own question group; replacement returns the displaced answer to the bank. Reusable-answer banks remain reusable; Review remains read-only.
- Sentence-ending slots share a width measured from every option's rendered text (minimum 394px, capped by the content column). Empty and filled slots keep the same width and reserved height; narrow layouts wrap full answers without clipping.

## Writing test room

Writing instructions, student responses and corrected essays are left aligned. Part navigation and the splitter follow the Reading/Listening test controls. Review and grading show each task's instruction, prompt and chart/visual before the response.

Trong không gian chấm và review Writing (Manuscript Editorial Desk):
- Chấm điểm 4 tiêu chí IELTS chuẩn (Task Achievement / Response, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy) kèm mô tả Public Band Descriptors và 3 trọng tâm cải thiện (Bottlenecks).
- Hệ thống thẻ trôi thông minh (`FloatingCardPortal`): Toàn bộ thẻ chú thích (Hover Card) và bảng soạn thảo (Selection Pill & Composer) được gắn vào `document.body` với định vị thích ứng tự động lật (`Smart Vertical Auto-Flip`), mũi tên định hướng và kẹp biên an toàn, triệt tiêu hoàn toàn hiện tượng rung giật giao diện (jitter loop).
- Cầu nối chống rung chuột (`Debounced Hover-Intent Bridge` 60ms/150ms) kết hợp thuật toán bắt đúng dòng văn bản bị ngắt (`getTargetClientLineRect`), cho phép học sinh rê chuột xem giải thích lỗi và xem gợi ý Band 8+ (xuất hồ sơ đầy đủ qua Dossier PDF).
- Trợ lý AI Selection Critique & Chấm tự động toàn bài: Bộ định tuyến suy luận chuyên dụng (`_writing_eval_chat`) ưu tiên các mô hình mạnh nhất (Tier 1: Google Gemini 2.5 Pro / Flash đa phương tiện với thinking budget 2048; Tier 2: Groq 120B reasoning; Tier 3: Cerebras 120B reasoning). Tự động nạp và nhận diện biểu đồ Task 1 qua `image_part` Base64. Cung cấp endpoint chuyên dụng `/api/ai_critique` với cơ chế retry 3 cấp độ tự động fallback khi gặp lỗi JSON mode (`json_validate_failed`), bóc tách regex an toàn, chuẩn hóa trường `replacement` / `comment` / `criterion` / `category`, và khắc phục triệt để lỗi HTTP/2 `res.statusText` rỗng khi hiển thị lỗi frontend. Hỗ trợ tự động lưu bản nháp (`autoSave=true`) ngay khi click.
- Hiệu chuẩn Chống Giảm Điểm Oan (Anti-Band Deflation Protocol): Tuân thủ nghiêm ngặt thang chấm chính thức IELTS May 2023, triệt tiêu thiên kiến neo điểm 6.0 (Schema Anchoring Bias), đánh giá 4 tiêu chí độc lập trước khi gắn lỗi, phân định chuẩn mực giữa `error` thực sự và `upgrade`/`praise`, bảo đảm các bài luận Band 7.5–8.5 không bị dìm điểm vô lý. Áp dụng quy tắc làm tròn điểm IELTS chính thức (`< 0.25 -> 0.0`, `>= 0.25 & < 0.75 -> 0.5`, `>= 0.75 -> 1.0`).
- Xuất tài liệu học thuật PDF vector (Academic Assessment Dossier): Động cơ in vector chuẩn in ấn (Print-to-PDF) qua hidden iframe, tài liệu sắc nét ở mọi độ phân giải, tự động trích xuất và nhúng biểu đồ Task 1 trực tiếp qua backend proxy `/api/image_base64` và thẻ `<img>` không bị chặn CORS browser (`referrerpolicy="no-referrer"`), 4 cột tiêu chí nằm ngang, đánh số chú thích `[1]`, `[2]` đồng bộ với bảng đối chiếu sửa lỗi chi tiết (.pdf-no-break), bản sửa hoàn chỉnh và bài mẫu Band 8+.
- Tính điểm Overall Band thông minh cho bài thi đơn task / chấm 1 task: Hiển thị chính xác điểm của task đã chấm (không bị chia sai thành Band 2 khi Task 2 chưa chấm), hỗ trợ publish bài làm đơn task hoặc bài chấm từng phần.
- Công nghệ phân đoạn văn bản bảo toàn 100% (Lossless Segmentation Engine): Khắc phục triệt để hiện tượng cắt cụt chữ hoặc rớt mệnh đề khi highlight/diff trên cả giao diện Web và PDF.

Writing uses a dedicated two-part IELTS workspace. Part 1 and Part 2 share one timer and one attempt, while each answer is autosaved independently. The test room uses the same renderer for Preview and student runtime, supports the existing highlight/note tools on prompts, and renders optional Part 1 media beneath its prompt.

Test-room media URLs support PNG, JPEG, WebP, GIF and SVG, including Firebase Storage links with `?alt=media&token=...` query strings and CDN URLs. The HTML formatting engine strictly preserves all query strings (preventing 403 Forbidden errors from truncated tokens), enforces `referrerpolicy="no-referrer"` and `loading="lazy"` across all rendered `<img>` elements (bypassing third-party hotlinking protections), and automatically normalizes Google Drive view/share URLs into direct image streams (`drive.google.com/uc?export=view&id=...`). The DOMPurify sanitizer whitelist explicitly permits `referrerpolicy` and `loading`. Remote SVG is rendered through normal `<img>` tags, not injected as inline SVG.

## Public release additions

- Writing is a first-class test type with Task 1/Task 2, attempt autosave, four-criterion grading, corrected versions, anchored comments, draft, and teacher-controlled publish.
- High-Intelligence Writing AI Evaluation Engine: Multi-tier fallback routing (Gemini 2.5 Pro/Flash thinking with Task 1 multimodal chart grounding -> Groq 120B reasoning -> Cerebras 120B reasoning) calibrated against official IELTS May 2023 public descriptors to eliminate Band deflation on high-performing essays.
- Flow-chart completion unwraps DOCX paragraph containers before splitting the original marker into inline text/gap/text segments, so slots stay at their authored position. Compact left-aligned step boxes and embedded SVG connector arrows are shared by Preview, Test Room, and Review. Matching Sentence Ending uses left-aligned prompts, fixed-width row gaps, move-style drag labels, and restores an answer to its bank when it is returned from a gap.
- The Student Portal is redesigned under the Manuscript Editorial design system: sticky navbar with segmented desktop tabs, dismissible teacher message callouts, intelligent OS Coins formatting, a 4-column overview ledger with a two-column study desk, spaced skill filters in Test Room, unlimited practice attempts handling (`Attempts: X (Unlimited)` with lockout prevention), 16 rotating daily Band 7.5+ academic expressions with 1-click notebook addition, and chronological progress charts with skill-based filtering.
- Teachers configure a shared consumable/permanent gift catalog and reward mechanisms. New ledger operations capture a gift/price snapshot so history remains meaningful after a catalog edit.
- Batch DOCX import accepts up to 20 Reading, Listening, Writing, or Integrated files. Exam Builder reviews every file and adds only the teacher-confirmed valid subset in one catalog write; Quest keeps its ordered-chain confirmation flow.
- Complete Bilingual (EN / VI) Localization Parity: Reactive `tx(vi, en)` engine throughout all teacher and student surfaces (Writing Feedback desk, selection composer, X-Ray telemetry bar, criteria scores, Academic Assessment PDF Dossier, Student Portal, Exam Builder, Live Arena, and Active Exam room). Eliminates hardcoded Vietnamese text leaks when switched to English mode.
- Multi-Paragraph `[EXPLANATION]` Support: Preservation of `\n\n` paragraph breaks across question-level explanations and supplement DOCX files without line flattening or leakage into question text. Review quiz renders distinct, beautifully spaced `<p>` paragraphs.
- External Diagram Labelling (Official Computer-Delivered IELTS Layout): Map, plan, and diagram questions with external blanks or drag cards render as a responsive side-by-side layout: clean diagram on the left without zoom/placeholder container; clean question labels without bracketed markers on the right; inline dashed dropzones displaying bold question numbers when empty and styled blue option pills when filled; inline bookmark button; and a bottom flex-wrap draggable option bank with letter prefixes and no container box. Includes graceful parser fallback for `[MAP_DRAG]` without slots and `[DIAGRAM_LABEL]` without boxes.
- Click-to-Zoom Lightbox Modal (Writing Task 1 Exclusive): Full-screen centered modal via `createPortal` with backdrop blur, SVG close button, and Esc listener strictly for Writing Task 1 charts in teacher evaluation and student review.
- Listening Range Timestamps & Interactive Transcript Navigation: Full support for both single timestamps (`[mm:ss]`) and range timestamps (`[mm:ss - mm:ss]`) with Word dash tolerances (`-`, `–`, `—`, `−`, `~`, `to`). Interactive inline badges in teacher explanations and Why modal footer seek audio to start seconds and locate evidence in transcript via multi-node TreeWalker with paragraph-level fallback.
- GCP Credit Integration & Scale-to-Zero Cloud Run Deployment:
  - Zero-dependency OAuth2 access token generation using existing `FIREBASE_SERVICE_ACCOUNT_JSON` with memory token caching and 5-minute pre-expiry refresh.
  - Daily request circuit breaker (`GCP_DAILY_REQUEST_CAP=800`) with UTC reset to prevent runaway billing spikes, automatically falling back to free API key pool (`GEMINI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`).
  - Tier 0 Primary Vertex AI routing: `gemini-2.5-pro` (`thinking_budget=4096`, `temperature=0.1`) for high-precision Writing evaluation and Task 1 multimodal chart verification, and `gemini-2.5-flash` for high-quota AI explanations without free-tier 429 rate limits.
  - Large audio transcription pipeline supporting external URLs up to 384 MB streamed in 64 KB chunks, stripped of video/subtitles/cover-art (`-vn -sn -dn -map 0:a:0 -ac 1 -ar 16000 -c:a libmp3lame -b:a 48k`), transcribed in parallel with Groq Whisper and Vertex AI `gemini-2.5-flash` timestamp fallback `(mm:ss - mm:ss)`.
  - AI Exam Scanner (`POST /api/scan_exam_page`): Ingest 1–5 photographed/scanned exam pages (PNG/JPG/WEBP) or PDF files via Cloud Vision `DOCUMENT_TEXT_DETECTION` OCR + Vertex AI `gemini-2.5-pro` structured into DOCX Formatter Playbook syntax and compiled into tests in Exam Builder via bilingual `tx("Quét ảnh/PDF đề (AI)", "Scan Exam Image/PDF (AI)")` button.
  - Edge CDN caching headers: `Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable` and `Accept-Ranges: bytes` across `/api/audio/...`, `/api/exam-media/...`, and Firebase Storage audio uploads for permanent caching and instant seek performance.
  - Cloud Run Scale-to-Zero deployment configuration: `Dockerfile`, `.dockerignore`, `deploy_cloud_run.sh` targeting `asia-southeast1` with `--min-instances=0`, `--max-instances=4`, `--cpu=2`, `--memory=2Gi`, `--timeout=900`, `--concurrency=40`, `--cpu-throttling` ensuring $0 idle cost.
- 4 High-Impact AI Pedagogical Features:
  - 100% Automatic Error DNA & Weakness Diagnostic Engine: Auto-runs on app load or exam submission without button clicks. Computes 0ms deterministic breakdown by 8 canonical IELTS question types (`CANONICAL_IELTS_TYPES`) and diagnoses cognitive vulnerabilities (`POST /api/analyze_error_dna`) via Vertex AI into Lexical Gap %, Distractor Trap %, Scope Misread % (summing to 100%), recurring traps with severity ratings, and 7-day action plans rendered in both Student Portal and Teacher Students View.
  - Distractor Deconstructor 2.0 & Streamlined Why (AI): Upgrades `/api/ai_explain` and review view with clean bento cards: concise trap diagnosis badge, compact horizontal paraphrase comparison chips (eliminating oversized empty tables), and strictly deterministic option distractor elimination tags (`CORRECT` / `ELIMINATE` / `YOUR CHOICE · ELIMINATE`). Features automatic option prefix deduplication (stripping redundant `A. A.`), multi-tier correctness matching supporting index, letter, text, array, and TFNG formats, comprehensive transcript fallback chains across Listening parts with zero false "No Audio" complaints, and pedagogical strategy guidance for unanswered questions.
  - Independent 1-on-1 IELTS AI Master Tutor: Floating dockable copilot with full conversational freedom (not restricted to a single question). Powered by omniscient test context (`POST /api/review_copilot`) to analyze the full exam or pinpoint any question mentioned in chat. Features clean markdown hierarchy (headings, bullet points, preserved bold styling), smart evidence buttons filtered strictly to authentic passage/transcript citations, synchronized audio timestamp pills (`[mm:ss]`), scroll trap prevention during audio playback, window expand/collapse (425px -> 680px), online beacon indicator, and silky smooth spring animations.
  - Writing Brainstorm & Outline Sandbox: Controlled by teacher practice toggle `allowWritingSandbox` in Exam Builder (disabled in Real Exam mode). Provides collapsible drawer in Active Exam with Tab 1 for critical perspectives & C1/C2 academic collocations, and Tab 2 for outline logic & coherence evaluation (`POST /api/writing_sandbox_coach`). Featuring unlocked vertical scrolling (`overflowY: 'auto'`, `minHeight: 0`, and `flexShrink: 0` on response `<textarea>`), ergonomic single-row header bar with compact max-height scrollable card body (`34vh`), and 100% natural Band 8.5+ Academic English output (eliminating unnatural translation leaks). Sticky part switcher buttons (`←` / `→`) ensure smooth navigation without blocking text areas.
- Hierarchical URL Routing Engine (Đồng Bộ URL Đa Tầng Không Phụ Thuộc Thư Viện Ngoài):
  - Ánh xạ 2 chiều thời gian thực giữa trạng thái ứng dụng React và URL trình duyệt qua HTML5 History API (`pushState`, `popstate`), tương thích hoàn toàn với SPA rewrite của Vercel (`vercel.json`) và Service Worker (`public/sw.js`).
  - Hỗ trợ deep linking, chia sẻ link trực tiếp và điều hướng Back/Forward tự nhiên cho mọi phân hệ: Auth (`/login`), Hệ thống (`/seb-guide`), Phòng thi (`/exam/:quizId`, `/exam/:quizId/real-mock`), Xem lại bài thi (`/exam/review/:resultId`, `/exam/writing-feedback/:resultId`), Bàn chấm giáo viên (`/teacher/grading/:resultId`), Bàn học học sinh (`/student/dashboard`, `/student/exams`, `/student/quests`, `/student/vocab`, `/student/rewards`, `/student/progress`), và Bàn làm việc giáo viên (`/teacher/dashboard`, `/teacher/exams`, `/teacher/exams/:quizId`, `/teacher/students`, `/teacher/students/:studentId`, `/teacher/classes`, `/teacher/arena`, `/teacher/finances`, `/teacher/drive`, `/teacher/quests`, `/teacher/academics`, `/teacher/history`).
- Auto-Group VOL Series & Extra Practice Tests in Student Portal Exam Room:
  - Zero manual tagging or data migration: Automatically detects VOL collections (e.g. VOL 6, VOL 7, VOL 8, VOL 9, VOL 10, and VOL W for Writing tests `W-1`, `W-2`, etc.) dynamically from `quiz.folder` and `quiz.title`.
  - Interactive VOL Pill Selector: Horizontal scrollable pill bar displaying each VOL series, test completion counters (`X/Y đề`), success indicators for completed VOLs, and an 'All Volumes' stacked view.
  - Dedicated Extra Practice Section: Cleanly isolates non-VOL quizzes into a distinct section beneath the VOL series grouped by folder or general practice.
  - Natural Numeric Sorting: Ensures natural ascending test sequence (e.g., Test 1 -> Test 2 -> ... -> Test 10) avoiding naive alphabetical sort traps.
  - Results & Review VOL Badges: Adds compact, color-coded VOL badges next to `quizTitle` in the Results tab for rapid historical recognition.
- Zero-Latency Instant Audio Playback Engine for Listening Exams:
  - Hoisted persistent `<audio ref={audioRef}>` portal (`createPortal(..., document.body)`) keeping audio elements and buffered frames permanently alive across `pendingExamState`, `realExamInstructionGate`, and `activeExam`.
  - Dynamic `<link rel="preconnect">` and `<link rel="dns-prefetch">` injection for audio origin hosts to minimize DNS resolution and TCP handshake latency.
  - Active audio readiness telemetry (`isAudioReadyToPlay`) requiring sufficient playable frames (`readyState >= 3` or buffered duration >= 5s) before enabling test start.
  - User-gesture audio pipeline priming in `PENDING_EXAM` and Real Exam Gate to unlock browser autoplay restrictions in advance.
  - Instantaneous playback (<50ms) in `requestManagedAudioPlayback` with non-blocking touch audio warm and zero visual lag overlay dismissal.
- Listening Two-Column Matching & Flow-Chart Drag Optimization:
  - Automatic routing of Listening `MATCHING` questions to the official IELTS 2-column drag-and-drop interface (`idp-match2`) without rendering Reading radio matrices.
  - Multi-condition option reuse engine (`reuseTags`) preserving options in the drag bank when instructions allow ("more than once"), when answer keys contain duplicate selections, or when configured via `allowOptionReuse` / `[REUSE_OPTIONS]`.
  - Dropzone question number preservation (`data-placeholder`) ensuring empty or cleared slots never lose their prompt numbers upon DOM restoration.
  - Flow-Chart Drag-and-Drop 100% CBT Parity: Global CSS display inline override preventing dropzone line breaks, chart title and unnumbered step preservation (`flowTitle`, `flowSteps`) with backward-compatible extraction, uniform boxed node styling with centered heading, seamless inline dropzones (100px min-width, 28px height, 1px dashed border), solid black connector arrows, and right-hand word bank cleanly top-aligned with the flowchart.
- Map Labelling Onto Map (`MAP_DRAG`) Firebase Storage & SVG Dimension Stabilization:
  - Full URL parameter preservation: Patched `url_re` in DOCX parser avoiding truncation of filenames with parentheses (e.g. `campus%20(2).svg?alt=media&token=...`) and HTML entity unescaping (`&amp;` -> `&`).
  - Auto-generated default slots (`x: 50.0`, `y: 18.0 + idx * step`, `width: 16.0`, `height: 7.0`) ensuring questions are never dropped when `[SLOTS]` is omitted.
  - Universal media resolvers (`normalizeExternalMediaUrl`, `resolveQuestionMapUrl`) and cross-field synchronization (`mapImageUrl` / `groupImageUrl` / `diagramImageUrl`).
  - Elimination of SVG 0x0 collapse across Exam Builder, Active Exam, and Review Quiz via container and image width/height constraints with `referrerPolicy="no-referrer"`.

### Retention cron

`vercel.json` invokes `/api/maintenance/cleanup_attempts` at 03:00 daily. It removes ordinary attempts 30 days after `submittedAt`, expired Writing drafts, and Writing attempts only 30 days after grading has been published.

The endpoint is server-only. Before deploy, configure these Vercel environment variables:

| Variable | Purpose |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Admin service-account JSON used by the maintenance job |
| `CRON_SECRET` | Bearer secret required by the Vercel Cron request |

If either server dependency is unavailable, the job returns an error and deletes nothing. Install Python dependencies with:

```powershell
python -m pip install -r requirements.txt uvicorn
```

IELTS OS là nền tảng quản lý học tập và thi IELTS trên máy tính dành cho giáo viên và học sinh. Hệ thống gom quy trình tạo đề, nhập đề từ DOCX, tổ chức bài thi, chấm và review, quản lý lớp học, từ vựng, nhiệm vụ học tập và kỳ thi thật vào một ứng dụng web.

- Production: <https://ielts-os-sandy.vercel.app>
- Frontend: React 19, TypeScript, Vite
- Backend: FastAPI chạy qua Vercel Functions
- Dữ liệu và đăng nhập: Firebase Authentication, Firestore, Firebase Storage
- PWA: service worker và manifest để cài đặt ứng dụng, hỗ trợ mạng chập chờn

## Chức năng chính

### Phòng thi IELTS

- Listening, Reading và Integrated với giao diện mô phỏng bài thi máy tính.
- Timer, điều hướng theo part/passage/câu hỏi, đánh dấu câu, note, highlight, gạch lựa chọn và scratchpad.
- Split view Reading có splitter điều chỉnh độ rộng hai cột.
- Các dạng câu hỏi: Choice, Multiple Choice, Blank, Short Answer, Matching, Matching Headings, Drag and Drop, Map Drag và Diagram Label.
- Matching một hoặc hai cột, option bank co theo nội dung, slot cố định và kéo thả không làm đổi cỡ chữ; card kéo và drag preview được canh cùng độ dày với slot; đáp án Matching Features được chuẩn hóa whitespace/ký tự vô hình khi lưu, chấm và xuất Excel; title và option dùng chung highlight/note persistence.
- Diagram hỗ trợ ảnh nền, box, overlay và text box.
- Listening strict mode tự bảo vệ luồng audio, tiếp tục phát sau gián đoạn tạm thời và không cho tua trái phép. Khi màn hình hướng dẫn của bài Listening đang mở, app chỉ prewarm một Range 256 KB của đúng audio hiện tại; không autoplay, không khởi động timer và tự bỏ qua Data Saver/2G.
- Kiểm soát fullscreen, focus, vi phạm rời màn hình và trạng thái nộp bài.
- Giao diện responsive cho desktop và thiết bị di động.

### Kỳ thi thật

- Gói thi LR hoặc LRW, làm bài đúng thứ tự do giáo viên cấu hình.
- Passcode, đối tượng học sinh, lịch mở/đóng, số lần làm và trạng thái hoàn thành.
- Test taker ID, pre-test checks, màn tổng hợp và bottom bar riêng có nhận diện IELTS OS tinh gọn ở góc trái, nhất quán cả khi vào luồng làm bài.
- Video hướng dẫn Listening/Reading/Writing bắt buộc xem hết trước khi xác nhận vào bài. Writing dùng bản 60 giây được quản lý tập trung, không cấu hình link riêng trong từng đề.
- Video được phục vụ từ static CDN của chính bản deploy, cache dài hạn và preload video của bài kế tiếp ngay tại màn tổng hợp. Listening/Reading dùng MP4 H.264 720p/30fps tương thích Chromium để video không treo ở màn hình tải.
- Yêu cầu trở lại fullscreen trước khi tiếp tục nếu thí sinh thoát toàn màn hình.

### Exam Builder và Quản lý Đề thi (File Manager)

- Giao diện thư viện đề thi thiết kế theo chuẩn Manuscript/Editorial: bố cục giấy ấm, font serif Fraunces, viền hairline 1px và bảng màu tối giản không gây mỏi mắt.
- Hệ thống quản lý thư mục chuẩn desktop file manager: hỗ trợ thư mục trống bền vững (lưu trữ độc lập qua `examFolders` và đồng bộ Firestore mà không cần tạo quiz nháp rác).
- Kéo thả trực quan (Drag-and-Drop): hỗ trợ kéo đề thi hoặc thư mục thả trực tiếp vào các thẻ thư mục con hoặc thả vào bất kỳ mắt xích nào trên thanh breadcrumb để di chuyển tức thì.
- Thao tác thư mục đầy đủ qua Modal tương tác: Tạo mới, Đổi tên, Di chuyển theo cây thư mục trực quan và Xóa thư mục an toàn (tự động chuyển đề con về thư mục cha).
- Đồng bộ Real-Time Đa thiết bị & Triệt tiêu giật cục (Zero-Jitter Sync): Tự động khử snapshot cũ khi có write in-flight, cửa sổ ổn định sau ghi 1400ms và bảo vệ focus window 2500ms; giải quyết xung đột bằng revision/updatedAt và cơ chế bia mộ (tombstones) cho lịch sử, lịch học, giao dịch và thư mục, đảm bảo không bao giờ bị mất đề (0 exams trên F5) hay nhảy giật 2 giây khi thao tác trên nhiều tab/thiết bị.
- Thanh công cụ thao tác hàng loạt (Bulk Command Bar): chọn nhanh theo thư mục, chuyển chế độ Exam/Practice, Publish/Unpublish/Publish ready, di chuyển hàng loạt đến thư mục đích, khóa/mở khóa và xóa an toàn.
- Bộ lọc và sắp xếp nâng cao: lọc đề theo kỹ năng (Listening, Reading, Writing, Integrated), sắp xếp theo tiêu đề (A-Z), thời gian tạo (Mới nhất) hoặc số lượng câu hỏi, kèm tìm kiếm real-time.
- Cấu hình đề: thời gian, số lần làm, lịch thi, passcode, học sinh mục tiêu, audio, passage, transcript, hình ảnh và đáp án.
- Import đề Reading/Listening/Writing/Integrated từ DOCX bằng parser FastAPI; nút DOCX của Exam Builder nhận tối đa 20 file, hiển thị review từng file và chỉ lưu các file hợp lệ sau nút xác nhận.
- Import bổ sung passage hoặc explanations vào đề có sẵn.
- Manual explanation hỗ trợ evidence quote và timestamp Listening để review đúng đoạn audio.
- Quy chuẩn DOCX đầy đủ nằm trong [DOCX_FORMATTER_PLAYBOOK.md](DOCX_FORMATTER_PLAYBOOK.md).

### Review và AI

- Chấm điểm, band score, đáp án, bài làm học sinh và feedback giáo viên.
- **Bàn làm việc Chấm & Review Writing (Writing Manuscript Editorial Desk)**: Không gian làm việc 2 cột chuẩn biên tập học thuật với điều hướng Task 1 & Task 2, ngăn kéo xem đề/biểu đồ linh hoạt, 4 chế độ đọc (Bản gốc có chú thích, Inline Track Changes Diff, Bản sửa hoàn chỉnh, và Bài mẫu Band 8+).
- **Hệ thống Chú thích & Tương tác thông minh**: Hover popover card có 120ms bridge hiển thị 4 tiêu chí (TA/TR, CC, LR, GRA), phân loại lỗi (Lỗi sai, Chưa tự nhiên, Nâng cấp Band 7.5-8.5), đề xuất thay thế, gợi ý Band 8+; trình soạn chú thích 2 giai đoạn (`Selection Pill` & `Composer`) kèm gắn nhanh tag lỗi cho giáo viên.
- **Thanh X-Ray & Radar lặp từ**: Theo dõi số từ (badge đạt/thiếu từ), số đoạn, số câu, mật độ từ trung bình, và radar tự động phát hiện các từ lặp lại từ 3 lần trở lên.
- **AI Co-Pilot chấm nháp Writing**: Tích hợp `/api/ai_feedback` sinh bảng điểm 4 tiêu chí chuẩn IELTS 9-band, 3 trọng tâm khắc phục (bottlenecks), các điểm sáng, 6-10 chú thích chuẩn vị trí văn bản, bản sửa sạch và bài mẫu Band 8.5 cho giáo viên kiểm duyệt và áp dụng trong 1 click.
- **Xuất Dossier PDF chuẩn học thuật**: Xuất file PDF/in ấn chuyên nghiệp gồm bảng điểm, ma trận tiêu chí, kế hoạch hành động, bài viết đánh số chú thích số mũ và bảng đối chiếu chi tiết sửa lỗi.
- **Academic Review Workbench (Reading, Listening & Integrated)**: Giao diện sửa bài chuyên sâu với tab `Tổng quan` (Error DNA, thống kê theo dạng bài & Part/Passage) và các tab chi tiết 2 cột. Bảo toàn đầy đủ bảng biểu HTML (`<table>`), tiêu đề/hướng dẫn nhóm câu (`Questions X–Y` & instructions), bảng chú thích `List of Options / Legend` cho Matching Features / Sentence Endings / Column Drag, trình hiển thị giải thích hỗ trợ Markdown (`**bold**`, `*italic*`, `"clickable quotes"`, `[MM:SS]`), chế độ `Làm lại câu sai` tách biệt trạng thái gốc và trạng thái làm lại, cùng ngăn kéo `Trợ lý AI` ngữ cảnh toàn bài.
- AI explain, AI feedback, AI critique từng câu Writing, transcription và trích xuất từ vựng.
- Chuỗi provider AI có xoay key và fallback giữa Groq, Cerebras, Gemini; OpenAI có thể được ưu tiên cho vocabulary khi được cấu hình.
- Phân loại từ vựng thành single word, phrasal verb, collocation, idiom và fixed expression.

### Quản lý học tập

- Dashboard giáo viên theo chuẩn Manuscript/Editorial (sổ cái doanh thu và giờ dạy tích luỹ căn lề trái với thanh accent dọc, danh sách lịch dạy chuẩn editorial có liên kết tài liệu/phòng học thông minh, lịch tháng và bảng thông báo tích hợp tinh gọn không lồng card).
- Quản lý học viên (Students) theo chuẩn Manuscript/Editorial: danh sách học viên tối ưu layout chống cắt cụt tên tiếng Việt, dải sổ cái KPI viền hairline 1px, biểu đồ Band Trend thông minh tự động chống đè nhãn và chống tràn lề ngày tháng, bộ lọc kỹ năng cho bài thi đã làm, phân tích dạng câu hỏi yếu chuẩn hóa tên sư phạm, cùng thanh công cụ học phí & quà tặng tinh gọn không nút màu mè.
- Classroom, academics, finance, history và drive.
- Topic assignments/quest theo chặng, điều kiện đạt, phần thưởng và tiến độ học sinh.
- Live Arena và các hoạt động học từ vựng.
- Vocab notebook có đồng bộ Firestore, backup cục bộ, tombstone khi xóa và cơ chế retry khi mạng lỗi.
- Quản lý coin, reward, inventory, streak, level và lịch sử hoạt động.

## Kiến trúc

```text
Browser
  ├─ React/Vite UI
  ├─ Firebase Auth + Firestore + Storage
  ├─ localStorage/IndexedDB journals cho retry và khôi phục phiên
  └─ Service Worker cho app shell, bỏ qua toàn bộ media/Range request

Vercel
  ├─ Static frontend + tutorial videos
  └─ /api/* -> FastAPI function (api/index.py)

AI providers
  └─ Groq / Cerebras / Gemini / OpenAI theo endpoint và cấu hình
```

### Lưu trữ dữ liệu

- Workspace chính: `ielts_workspace/trung_linh_data`.
- Live Arena: `ielts_workspace/live_arena`.
- Đề thi được tách thành subcollection `quizzes` để tránh giới hạn kích thước document Firestore.
- Vocab cards được tách theo từng học sinh.
- Các thao tác quan trọng dùng journal cục bộ và chỉ xóa journal sau khi Firestore xác nhận từ server.

### Luồng DOCX

1. Giáo viên chuẩn hóa DOCX theo playbook.
2. Frontend gửi một file tới `/api/upload_docx`, batch tối đa 20 file tới `/api/upload_docx_batch`, hoặc file vá tới `/api/upload_docx_supplement`.
3. FastAPI kiểm tra ZIP/DOCX, đọc paragraph và table, nhận parser tags và dựng cấu trúc đề.
4. Exam Builder nhận dữ liệu đã parse để kiểm tra. Batch chỉ ghi một lần vào Firestore sau xác nhận rõ ràng; file lỗi không chặn các file hợp lệ.
5. Bộ test parser xác nhận explanations, matching answers, timestamps và vocabulary classification.

## Cấu trúc nguồn

```text
api/index.py                         FastAPI, DOCX parser và AI endpoints
public/sw.js                        PWA cache; bắt buộc bypass media/Range
public/instruction-videos/          Video hướng dẫn kỳ thi thật
src/App.template.tsx                Nguồn chính của App và shared state/logic
src/components_split/*.txt          Các khối UI lớn được chèn khi compile
src/App.tsx                         File tự sinh, không sửa trực tiếp
src/main.tsx                        Bootstrap React, error boundary, toast, PWA
compile_app.py                      Ghép template và components_split
DOCX_FORMATTER_PLAYBOOK.md          Chuẩn tạo và bóc DOCX
SESSION_HANDOFF.md                  Quy chuẩn hạ tầng và bài học ổn định
AGENTS.md                           Luật bắt buộc cho coding agent
tests/                              Unit tests cho backend/parser/AI helpers
vercel.json                         Functions, headers và rewrites production
```

## Chạy local

### Yêu cầu

- Node.js 20 trở lên
- Python 3.11 trở lên
- Tài khoản Firebase của dự án hoặc cấu hình Firebase tương ứng
- API key AI nếu cần dùng các tính năng AI

### Cài đặt

```powershell
npm install
python -m pip install fastapi uvicorn python-multipart python-docx
```

For local backend development, select the workspace `.venv\\Scripts\\python.exe` interpreter in VS Code, then install the server dependencies with `python -m pip install -r api/requirements.txt`. This includes `firebase-admin`, which is required for Firebase-authenticated manager actions.

Chạy backend ở cổng `8000`:

```powershell
python -m uvicorn api.index:app --reload --port 8000
```

Chạy frontend:

```powershell
npm run dev
```

Frontend tự gọi `http://localhost:8000` khi hostname là `localhost`, `127.0.0.1` hoặc `::1`. Trên production, frontend dùng API cùng origin qua `/api/*`.

## Biến môi trường backend

Không commit secret vào repo. Cấu hình trên local shell hoặc Vercel Project Settings.

| Biến | Mục đích |
| --- | --- |
| `APP_ALLOWED_ORIGINS` | Danh sách origin CORS, phân cách bằng dấu phẩy |
| `API_DOCS_ENABLED` | Bật `/api/docs` và OpenAPI khi là `1/true/yes` |
| `FIREBASE_STORAGE_BUCKET` | Tên bucket Firebase Storage **đã được provision**; bắt buộc cho raw-DOCX artifacts/media |
| `GROQ_API_KEY`, `GROQ_API_KEY_2...` | Pool key Groq cho chat và Whisper |
| `CEREBRAS_API_KEY`, `CEREBRAS_API_KEY_2...` | Pool key Cerebras |
| `GEMINI_API_KEY` hoặc `GOOGLE_API_KEY` | Pool key Gemini |
| `OPENAI_API_KEY` | Provider OpenAI, đặc biệt cho vocabulary |
| `GROQ_MODEL`, `CEREBRAS_MODEL`, `GEMINI_MODEL` | Override model theo provider |
| `GROQ_WHISPER_MODEL` | Model transcription Groq |
| `VOCAB_*` | Giới hạn, model, reasoning và refill cho pipeline vocabulary |

Các biến key hỗ trợ dạng phân cách bằng dấu phẩy/chấm phẩy và hậu tố `_2` đến `_8`. Xem `api/index.py` để biết default hiện hành.

## Build và kiểm thử

`src/App.tsx` là file sinh tự động. Mọi sửa đổi phải thực hiện trong `src/App.template.tsx` hoặc `src/components_split/*.txt`.

```powershell
python compile_app.py
npx tsc -b
npx vite build
python -m unittest discover -s tests -p "test_*.py"
```

Hoặc build production bằng script npm:

```powershell
npm run build
```

## Delivery modes and raw DOCX batches

- Every assessment has an explicit `deliveryMode`: **Exam** keeps its saved attempt, integrity and Listening replay policy; **Practice** has unlimited attempts and disables those restrictions. Legacy records with no explicit mode remain Exam.
- The Exam Library supports selected bulk conversion, publish, unpublish and publish-ready actions. Each action is revisioned, audited, idempotent and returns independent results; one failure never rolls back another record.
- `AI raw DOCX` accepts 1-20 source DOCX files with an Exam/Practice and Draft/Publish-when-ready pre-setting. It preserves upload order, uses at most two leased file workers plus two bounded Solver workers by default, and exposes each file's detection, stage, question progress, solve/explanation, validation, repair, parser round-trip and safe diagnostic state. Ready DOCX files can be downloaded from the batch panel.
- Its first AI pass is deliberately structural: it preserves visible content and rich formatting while deferring answers and evidence-based explanations to bounded per-question Solver workers. This prevents a long full-answer JSON response from being truncated before the canonical schema gate.
- Raw inputs, generated DOCX, parser/validation payloads and media live in Firebase Storage; batch state, ordered rows and leases live in Firestore. A Vercel function uses `/tmp` only as disposable scratch space. Browser retries and duplicate calls are safe because a worker must own a Firestore lease before it processes a file.
- A transient AI-provider failure is reported as `FAILED / GENERATION*` with `NOT_RUN` round-trip state, never as a DOCX parser failure. Raw-DOCX routing has its own monotonic deadline and rotates provider families before the outer watchdog expires; provider I/O and malformed JSON decoding share the same bounded retry envelope. Canonical schema, grounding, media and parser-contract gates remain fail-closed. An incomplete Solver/repair answer-evidence contract remains unpublished and can be retried explicitly from the batch panel.
- The client advances a batch only while it has queued rows and a free worker slot. Cross-tab Firestore claim contention returns the latest durable snapshot rather than a visible server error.
- Raw batch processing and output download require a Firebase-verified manager in `EXAM_MANAGER_EMAILS` (or explicit `TEACHER_EMAILS` fallback). In Vercel, set the variable to the comma-separated Firebase teacher logins (for example, `trung@ielts.os,linh@ielts.os`) before deploying; an empty allow-list deliberately returns HTTP 503. The service account also needs Firestore read/write and Firebase Storage object read/create/update/delete permission. Provision the bucket in Firebase Console before first use, then set its exact name in `FIREBASE_STORAGE_BUCKET`; `STORAGE_BUCKET_NOT_FOUND` means that the bucket is absent or the name is wrong. Set `EXAM_GENERATION_MEDIA_BASE_URL` to the canonical HTTPS site origin when generated charts/images must remain reachable outside the current production origin.

Không dùng `npx tsc --noEmit` đơn lẻ: `tsconfig.json` gốc không chứa source files và có thể báo thành công giả. Luôn dùng `npx tsc -b`.

## Deploy

Production deploy trên Vercel. `vercel.json` thực hiện:

- Chạy `api/index.py` dưới dạng Vercel Function.
- Cho phép `api/index.py` chạy tối đa 300 giây để hoàn thành một file AI đã được lease; state/output vẫn được checkpoint vào Firebase trước khi job được đánh dấu hoàn tất.
- Rewrite `/api/*` vào backend.
- Fallback route SPA về `index.html`.
- Cache immutable một năm cho tutorial videos có tên versioned.

Quy trình phát hành:

```powershell
npm run build
git push origin main
vercel --prod
```

Sau deploy phải kiểm tra URL production, `/api/health`, tải media bằng Range request và luồng thi thật.

## Quy tắc ổn định bắt buộc

- Không sửa trực tiếp `src/App.tsx`.
- Không cache audio/video hoặc request có header `Range` trong service worker.
- Dữ liệu do học sinh tạo phải merge theo union/tombstone hoặc transaction; không để snapshot giáo viên ghi đè cả mảng.
- Khi sửa highlight/note, đồng bộ cả `activeExam.questions` và `activeExam.sections[].questions`.
- Không thay asset thi bằng phiên bản cắt xén hoặc làm mất nội dung.
- Không commit file tạm, dữ liệu học sinh, secret hoặc output kiểm thử không thuộc thay đổi.
- Luôn typecheck, build và chạy test phù hợp trước khi deploy.

## Kỷ luật cập nhật tài liệu

Ba quy tắc này là điều kiện hoàn thành của mọi thay đổi:

1. Web có feature hoặc hành vi mới: cập nhật `README.md`.
2. Hạ tầng, build, deploy, cache, storage hoặc quy chuẩn làm việc thay đổi: cập nhật `SESSION_HANDOFF.md`.
3. Backend, API, parser hoặc cách bóc/tạo DOCX thay đổi: cập nhật `DOCX_FORMATTER_PLAYBOOK.md`.

Chi tiết lịch sử lỗi nghiêm trọng và quy tắc phục hồi nằm trong [SESSION_HANDOFF.md](SESSION_HANDOFF.md). Không bắt đầu sửa code trước khi đọc file đó.

## Managed Listening audio

- Exam Builder uploads Listening audio directly to the project's Storage bucket through a short-lived, teacher-only signed upload ticket. The browser sends the file to Storage itself, shows progress/cancellation, and receives a stable first-party `/api/audio/...` link; it never posts a large audio body through Vercel.
- Supported managed uploads are MP3, M4A, AAC, WAV, OGG/OGA, WebM and FLAC. The upload default is 512 MiB (`MAX_AUDIO_UPLOAD_BYTES`, capped at 1 GiB); Storage verifies filename, MIME, byte count and a file signature before returning the link.
- Transcript generation resolves first-party `/api/audio/...` links back to the verified Storage object and downloads bytes directly with Firebase Admin, avoiding a self-HTTP loop through the app audio proxy. Small direct public external audio URLs remain supported through the older HTTP path with explicit timeout/size errors. Managed sources up to 384 MiB by default (`MAX_AUDIO_TRANSCRIPTION_SOURCE_BYTES`) that exceed Whisper's 23 MiB request envelope are deterministically converted to 16 kHz mono 32 kbps chunks and retain source-time timestamps when joined. The serverless-safe default is 45 minutes / five chunks; longer recordings are rejected with an explicit split instruction instead of timing out a Vercel function.
- Set `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_STORAGE_BUCKET`, `EXAM_MANAGER_EMAILS`, and the canonical `APP_ALLOWED_ORIGINS`. The upload initializer installs/validates the narrow Storage CORS rule for trusted origins, so its service account needs Storage bucket metadata/CORS update permission in addition to object permissions. Add preview origins to `AUDIO_UPLOAD_CORS_ORIGINS`; use `AUDIO_PUBLIC_ORIGIN` only when storing absolute managed audio URLs.

## Academic Review Workbench & AI Source-Text Pipeline

- **Warm Editorial Review Workbench (`src/components_split/REVIEW_QUIZ.txt`)**:
  - Dedicated `Tổng quan` tab (`reviewSectionIdx === -1`) with Hero Summary, CSS conic-gradient Band Score donut chart, 3 circular SVG status counters (`Trả lời đúng`, `Trả lời sai`, `Đã bỏ qua`), 2×2 metric grid, 1–40 `Danh sách câu hỏi` jump matrix, and question-type accuracy progress bars.
  - Two-tab top header (`Tổng quan` & `Chi tiết`) paired with an Exam-Room-style bottom Part/Passage navigator (expanding question pills only for the active part while showing `X of Y` for inactive parts) and a resizable 50/50 Split-Workbench with sticky Listening audio bar (`Play/Pause`, scrubber, `1x / 1.25x / 1.5x / 2x` speed selector), multi-tier transcript/passage viewer, and contextual right-hand task view.
  - Inline Answer Comparison boxes (`.inline-ans-box` / `.dashed-drag-slot`) paired with a 4-button Inline Micro-Action Cluster (Teacher Lightbulb SVG, Evidence Locator Pin SVG, Audio `[MM:SS]` pill, and `AI` button) and expandable inline explanation drawers directly beneath each question line.
  - Minimalist free-form `Trợ lý AI` slide-over drawer (`380px`) backed by `POST /api/ai_review_chat`.
- **4-Tier AI Source-Text Resolution & Concise 3-Line Explanations**:
  - `resolveReviewQuestionContext` in `src/App.template.tsx` resolves section transcripts/passages across `quiz.sections[i]`, `quiz.passages[i]`, top-level `quiz.transcript` / `quiz.passage`, and DOM fallback, while extracting surrounding sentence context for numbered `[BLANK]` items.
  - `/api/ai_explain` in `api/index.py` outputs high-signal 3-line explanations (`• Bản chất:`, `• Dẫn chứng:`, `• Kết luận:`, max 75–90 words) without listing untouched options (`A–H`).

## Security & Large Upload Policy

- **Firestore & Storage Rules (`firestore.rules`, `storage.rules`, `firebase.json`)**: Workspace documents require Firebase Authentication; teacher-managed collections and fields (`quizzes`, `transactions`, `history`, `schedules`, `examFolders`, `topicAssignments`, `realExamPackages`, `sharedLinks`) are restricted to verified `@ielts.os` teacher accounts, and students are isolated to their own PII/vocab/results.
- **API Guard & SSRF Protection (`api/index.py`)**: AI, OCR, DOCX, and media proxy endpoints enforce Origin/Firebase Bearer token checks and per-IP rate limiting (`_verify_api_request_guard`), while external image/audio fetchers block private/loopback/link-local/metadata IP ranges and validate image magic bytes.
- **Large File Support Preserved**: DOCX uploads default to 100 MB (configurable up to 512 MB via `MAX_DOCX_UPLOAD_BYTES`), AI exam page scans are not capped at 15 MB, and Firebase Storage audio rules allow up to 512 MB (`MAX_AUDIO_UPLOAD_BYTES`).

## Practice Exam Exit, Unified 3-State Save Architecture, Quest Deck & Asset Management

- **Practice Exam Exit Without Saving (`src/components_split/ACTIVE_EXAM.txt`, `src/App.template.tsx`)**:
  - Practice exams display a `← Quay lại` button in the exam room top header (`exitPracticeExamWithoutSaving`). Clicking it prompts the student for confirmation, halts Listening audio, clears temporary exam state, and returns to the previous screen without saving or counting an attempt.
- **Unified 3-State Save UX Across All Editors (`src/App.template.tsx`, `src/WritingFeedback.tsx`, `src/components_split/EXAM_BUILDER.txt`, `src/components_split/TOPIC_ASSIGNMENTS.txt`, `src/components_split/STUDENTS.txt`)**:
  - All major save workflows (Exam Builder, Key Editor, Real Exam Package, Topic/Quest Assignments, Writing Feedback Grading, Student Profile/Gift Catalog) enforce three states: (1) inline loading spinner + disabled button (`Đang lưu...`), (2) floating top-right toast confirmation (`showSaveToast`), and (3) unsaved-changes protection (`beforeunload` + confirmation modal when closing or switching tabs with dirty changes).
- **Quest Selector Deck & Classified Permanent Inventory (`src/components_split/STUDENT_PORTAL.txt`, `src/App.template.tsx`)**:
  - The Quests portal tab uses a compact **Quest Selector Deck** (search bar + `Tất cả / Đang thực hiện / Đã hoàn thành` filters + selectable quest cards with progress bars) and renders only the active quest's stage map below instead of stacking all quests vertically.
  - Rewards Store and Inventory items render dedicated SVG artwork per item type (`renderGiftStoreIcon`), and the Permanent Inventory (`Vật phẩm Vĩnh viễn`) provides sub-category filter pills (`Tất cả`, `Khung Avatar`, `Danh hiệu`, `Linh thú`, `Giao diện`, `Khác`).
- **Teacher Confiscation of Coins & All Gift Types (`src/App.template.tsx`, `src/components_split/STUDENTS.txt`)**:
  - Teachers can confiscate any amount of OS Coins (or reset to `0`), consumables (`-1` or revoke all), permanent cosmetics (automatically unequipping active items and recording a `revokedPermanents` tombstone so anti-loss sync / `localStorage` never resurrects them), redeemed rewards (`myRewards`), or clear a student's entire inventory at once.

## Unified IELTS & Integrated Question Taxonomy & Student Portal Filter Pill Bar

- **Pure Non-Destructive Question Classifier (`src/questionTaxonomy.ts`, `src/App.template.tsx`, `api/index.py`)**:
  - Automatically classifies 100% of questions and Writing tasks in runtime without mutating `q.type` or `q.subType` (0% risk of breaking exam room layout or scoring).
  - Canonical taxonomy across 4 distinct skills (`Listening`, `Reading`, `Writing`, `Integrated`):
    - **Listening**: `L_FORM_NOTE`, `L_TABLE`, `L_SENTENCE_SUMMARY`, `L_FLOWCHART`, `L_SHORT_ANSWER`, `L_MAP_PLAN`, `L_DIAGRAM`, `L_MCQ_SINGLE`, `L_MCQ_MULTI`, `L_MATCHING`.
    - **Reading**: `R_TFNG`, `R_YNNG`, `R_MATCHING_HEADINGS`, `R_MATCHING_INFO`, `R_MATCHING_FEATURES`, `R_SENTENCE_ENDINGS`, `R_SUMMARY_BOX`, `R_NOTE_TABLE_SUMMARY`, `R_DIAGRAM_FLOWCHART`, `R_SHORT_ANSWER`, `R_MCQ_SINGLE`, `R_MCQ_MULTI`.
    - **Writing**: Task 1 (`W_T1_LINE`, `W_T1_BAR`, `W_T1_PIE`, `W_T1_TABLE`, `W_T1_MIXED`, `W_T1_MAP`, `W_T1_PROCESS`) and Task 2 (`W_T2_OPINION`, `W_T2_DISCUSSION`, `W_T2_ADV_DISADV`, `W_T2_PROBLEM_SOLUTION`, `W_T2_TWO_PART`).
    - **Integrated**: `I_LISTENING`, `I_CLOZE_GRAMMAR`, `I_ARRANGEMENT`, `I_READING_COMP`, `I_SENTENCE_TRANSFORM`.
- **Dedicated "Integrated" Skill Tab & 2-Column Bento Grid Popover (`src/components_split/STUDENT_PORTAL.txt`)**:
  - Integrated tests receive their own dedicated tab alongside Listening, Reading, and Writing in both Exam Room and Progress sections.
  - Compact SVG Filter button next to the search bar with active badge counter, opening an expansive 2-column Bento Grid Popover (~540px) displaying 100% full text without truncation or awkward horizontal scrolling.
  - Each item features a custom checkbox, category label, and real-time test counter. Footer displays total matching tests with 1-click Clear and Apply actions.
  - Slim card presentation: When unfiltered, cards stay clean and compact with zero noisy tag clutter; when filtered, matching test cards display high-visibility accent location badges (e.g. `Part 2 · Map / Plan Labelling`).
- **Exam Builder & Review Analytics Standardization (`src/components_split/EXAM_BUILDER.txt`, `src/components_split/REVIEW_QUIZ.txt`, `src/components_split/STUDENTS.txt`)**:
  - Exam Builder replaces the hardcoded subType dropdown with a canonical Category dropdown populated dynamically by skill, and adds Task 1 / Task 2 category selectors for Writing tasks.
  - Review Quiz and Student Weakness Analytics display human-readable canonical IELTS category names.

## Modern Academic Studio Login Screen

- **EdTech Academic UI Redesign (`src/App.template.tsx`)**:
  - Eliminated the previous pitch-black and gold-champagne palette ("Editorial Luxe") in favor of a clean, trustworthy, and student-friendly **Modern Academic Studio** aesthetic (Oxford/Cambridge × Notion/Duolingo Max).
  - Background palette: Warm off-white (`#F8FAFC`) with subtle ambient blue-indigo glows, deep slate typography (`#0F172A`), and academic cobalt royal blue accents (`#2563EB`).
  - Left column feature showcase: Replaced raw numbers with clean modern icon cards highlighting 3 core student values:
    1. **Mô phỏng thi thật**: Phòng thi máy tính chuẩn mực, quen tay trước ngày thi.
    2. **AI chữa đề thông minh**: Dẫn chứng chính xác, giải thích cặn kẽ từng câu.
    3. **Phân tích điểm yếu theo dạng bài**: Tự động nhận diện những dạng câu hỏi cần cải thiện và lỗi tư duy phía sau.
  - Right column login form: Crisp white card with soft elevation, clean form labels, clear email and password inputs with eye toggle, and high-contrast royal blue submit button. Fully responsive on mobile with clean authenticating modal overlay.
