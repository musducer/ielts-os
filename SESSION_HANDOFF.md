# IELTS OS — Session Handoff (2026-07-03)

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
- Luôn build + typecheck (`compile_app.py` + `tsc --noEmit`) trước khi báo "xong" — không suy đoán compile thành công.

## File/thư mục quan trọng cần biết

- `src/App.template.tsx` — nguồn thật của component chính, chứa toàn bộ state, hooks, hàm logic dùng chung (syncData, syncHighlightState, v.v.)
- `src/components_split/*.txt` — từng khối UI lớn được tách riêng (ACTIVE_EXAM, EXAM_BUILDER, DASHBOARD...) rồi compile_app.py ráp vào App.template.tsx đúng vị trí đánh dấu.
- `api/index.py` — backend FastAPI (AI vocab, AI explain, v.v.)
- `public/sw.js` — service worker, đã có bài học đau về audio caching, cẩn thận khi sửa.
- `compile_app.py` — script ráp file, PHẢI chạy sau mọi thay đổi ở template/components_split.
