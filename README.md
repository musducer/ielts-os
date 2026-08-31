# IELTS OS

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
- Matching một hoặc hai cột, option bank co theo nội dung, slot cố định và kéo thả không làm đổi cỡ chữ.
- Diagram hỗ trợ ảnh nền, box, overlay và text box.
- Listening strict mode tự bảo vệ luồng audio, tiếp tục phát sau gián đoạn tạm thời và không cho tua trái phép.
- Kiểm soát fullscreen, focus, vi phạm rời màn hình và trạng thái nộp bài.
- Giao diện responsive cho desktop và thiết bị di động.

### Kỳ thi thật

- Gói thi LR hoặc LRW, làm bài đúng thứ tự do giáo viên cấu hình.
- Passcode, đối tượng học sinh, lịch mở/đóng, số lần làm và trạng thái hoàn thành.
- Test taker ID, pre-test checks, màn tổng hợp và bottom bar riêng.
- Video hướng dẫn Listening/Reading bắt buộc xem hết trước khi xác nhận vào bài.
- Video được phục vụ từ static CDN của chính bản deploy, cache dài hạn và preload video của bài kế tiếp ngay tại màn tổng hợp.
- Yêu cầu trở lại fullscreen trước khi tiếp tục nếu thí sinh thoát toàn màn hình.

### Exam Builder và DOCX

- Tạo, sửa, preview, nhân bản, bật/tắt và phân phối đề.
- Cấu hình thời gian, số lần làm, lịch thi, passcode, học sinh mục tiêu, audio, passage, transcript, hình ảnh và đáp án.
- Import đề Reading/Listening/Integrated từ DOCX bằng parser FastAPI.
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
2. Frontend gửi file tới `/api/upload_docx` hoặc `/api/upload_docx_supplement`.
3. FastAPI kiểm tra ZIP/DOCX, đọc paragraph và table, nhận parser tags và dựng cấu trúc đề.
4. Exam Builder nhận dữ liệu đã parse để kiểm tra, chỉnh sửa và lưu vào Firestore.
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
