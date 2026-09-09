# IELTS OS

## Annotation and answer dragging

- Note/Highlight uses custom 64×64 SVG artwork. Each annotation keeps its own ID, type, text offsets, creation time and note content. Two or more highlights paint their intersection pink with black text in all three contrast modes. Single highlights retain the current theme colour; highlights cover note colouring without deleting notes. “Delete newest Highlight” removes only that annotation, revealing any underlying highlight/note.
- All interactive answer banks share a move cursor, blue hover/target border, isolated drag preview and faded source during dragging. Per the latest requested behaviour, non-reusable options disappear **only after a valid placement**, and return when dragged back to their bank. Cancellation leaves assignments intact. Used answers can move between gaps in their own question group; replacement returns the displaced answer to the bank. Reusable-answer banks remain reusable; Review remains read-only.
- Sentence-ending slots share a width measured from every option's rendered text (minimum 394px, capped by the content column). Empty and filled slots keep the same width and reserved height; narrow layouts wrap full answers without clipping.

## Writing test room

Writing instructions, student responses and corrected essays are left aligned. Part navigation and the splitter follow the Reading/Listening test controls. Review and grading show each task's instruction, prompt and chart/visual before the response. In grading, select text in the original essay and add a comment; highlighted passages and comment links let teachers and students find the relevant text. General feedback is also supported. Feedback remains hidden from students until published.

Writing uses a dedicated two-part IELTS workspace. Part 1 and Part 2 share one timer and one attempt, while each answer is autosaved independently. The test room uses the same renderer for Preview and student runtime, supports the existing highlight/note tools on prompts, and renders optional Part 1 media beneath its prompt.

## Public release additions

- Writing is a first-class test type with Task 1/Task 2, attempt autosave, four-criterion grading, corrected versions, anchored comments, draft, and teacher-controlled publish.
- Flow-chart completion unwraps DOCX paragraph containers before splitting the original marker into inline text/gap/text segments, so slots stay at their authored position. Compact left-aligned step boxes and embedded SVG connector arrows are shared by Preview, Test Room, and Review. Matching Sentence Ending uses left-aligned prompts, fixed-width row gaps, move-style drag labels, and restores an answer to its bank when it is returned from a gap.
- The student test room separates Listening, Reading, and Writing lists. Vocabulary Notebook can export to XLSX; scheduled lessons can contain lesson content and safe external material links.
- Teachers configure a shared consumable/permanent gift catalog and reward mechanisms. New ledger operations capture a gift/price snapshot so history remains meaningful after a catalog edit.
- Batch DOCX import accepts up to 20 Reading, Listening, Writing, or Integrated files. Exam Builder reviews every file and adds only the teacher-confirmed valid subset in one catalog write; Quest keeps its ordered-chain confirmation flow.

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

### Exam Builder và DOCX

- Tạo, sửa, preview, nhân bản, bật/tắt và phân phối đề.
- Cấu hình thời gian, số lần làm, lịch thi, passcode, học sinh mục tiêu, audio, passage, transcript, hình ảnh và đáp án.
- Import đề Reading/Listening/Writing/Integrated từ DOCX bằng parser FastAPI; nút DOCX của Exam Builder nhận tối đa 20 file, hiển thị review từng file và chỉ lưu các file hợp lệ sau nút xác nhận.
- Import bổ sung passage hoặc explanations vào đề có sẵn.
- Manual explanation hỗ trợ evidence quote và timestamp Listening để review đúng đoạn audio.
- Quy chuẩn DOCX đầy đủ nằm trong [DOCX_FORMATTER_PLAYBOOK.md](DOCX_FORMATTER_PLAYBOOK.md).

### Review và AI

- Chấm điểm, band score, đáp án, bài làm học sinh và feedback giáo viên.
- Review theo câu, nghe lại audio và nhảy tới timestamp liên quan.
- AI explain, AI feedback, transcription và trích xuất từ vựng.
- Chuỗi provider AI có xoay key và fallback giữa Groq, Cerebras, Gemini; OpenAI có thể được ưu tiên cho vocabulary khi được cấu hình.
- Phân loại từ vựng thành single word, phrasal verb, collocation, idiom và fixed expression.

### Quản lý học tập

- Dashboard giáo viên, classroom, student records, academics, finance, history và drive.
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
| `FIREBASE_STORAGE_BUCKET` | Bucket dùng để dựng URL media Firebase |
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

Không dùng `npx tsc --noEmit` đơn lẻ: `tsconfig.json` gốc không chứa source files và có thể báo thành công giả. Luôn dùng `npx tsc -b`.

## Deploy

Production deploy trên Vercel. `vercel.json` thực hiện:

- Chạy `api/index.py` dưới dạng Vercel Function.
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
