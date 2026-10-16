# IELTS OS — Session Handoff (cập nhật 2026-10-16)

## Tích hợp Tín dụng Google Cloud Platform (GCP Blaze Trial) & Triển khai Scale-to-Zero Cloud Run — 2026-10-16

- **Issue 1: Xác thực Không phụ thuộc SDK GCP & Circuit Breaker Chống Đội Chi Phí (Zero-Dependency Token Minting & Anti-Runaway Billing Guardrail)**:
  - *Mục tiêu*: Tận dụng hạn mức GCP Blaze Trial credit mà không làm phình to image triển khai, không xung đột thư viện và bảo đảm chi phí an toàn 100%.
  - *Giải pháp triệt để*:
    - Tận dụng chuỗi chứng thực `FIREBASE_SERVICE_ACCOUNT_JSON` có sẵn trên production để sinh OAuth2 Access Token cho REST API (`aiplatform.googleapis.com` và `vision.googleapis.com`) qua `google.oauth2.service_account.Credentials(scopes=["https://www.googleapis.com/auth/cloud-platform"])`.
    - Bộ nhớ đệm token (in-memory token caching) tự động refresh trước thời điểm hết hạn 5 phút qua `google.auth.transport.requests.Request()`.
    - Biến môi trường điều khiển: `ENABLE_GCP_VERTEX` (cho phép bật/tắt tức thì).
    - Circuit breaker hàng ngày: Bộ đếm `_GCP_DAILY_COUNTER` với ngưỡng mặc định `GCP_DAILY_REQUEST_CAP=800` (tự động reset theo ngày UTC). Nếu chạm ngưỡng hoặc có lỗi, hệ thống lập tức ngắt gọi GCP và chuyển tiếp 100% sang pool API key miễn phí (`GEMINI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`).

- **Issue 2: Định tuyến Ưu tiên Vertex AI cho Chấm Writing & Giải thích Đề thi AI**:
  - *Writing Evaluation (`_writing_eval_chat`)*: Thiết lập Tier 0 Primary sử dụng Vertex AI `gemini-2.5-pro` (`thinking_budget=4096`, `temperature=0.1`) cho độ chính xác cao trên bài luận Band 7.5–8.5+, hỗ trợ visual input (`inlineData`) đối chiếu biểu đồ Task 1. Tự động fallback sang Tier 1 (AI Studio `GEMINI_API_KEY`), Tier 2 (Groq), Tier 3 (Cerebras).
  - *AI Explanation (`/api/ai_explain`)*: Ưu tiên Vertex AI `gemini-2.5-flash` xử lý nhanh với hạn mức lớn, không bị chặn 429 rate limit của tier miễn phí, fallback tự động sang API keys miễn phí.

- **Issue 3: Xử lý Bóc tách Audio Lớn (35 MB – 384 MB)**:
  - *Streaming Download*: URL audio bên ngoài được stream xuống file tạm thành từng chunk 64 KB (cho phép file đến 384 MB thay vì bị giới hạn 25 MB).
  - *Transcode Tinh gọn*: `_transcode_whisper_chunk` loại bỏ hoàn toàn video stream, subtitle, và cover-art (`-vn -sn -dn -map 0:a:0 -ac 1 -ar 16000 -c:a libmp3lame -b:a 48k`) giúp nén audio 10 phút xuống chỉ ~3.5 MB.
  - *Chunking & Fallback*: Transcribe song song đa luồng; nếu Groq Whisper lỗi hoặc rate limit, tự động fallback sang Vertex AI `gemini-2.5-flash` sinh transcript dạng dải `(mm:ss - mm:ss)`. Tự động cộng offset mốc thời gian tuyệt đối chính xác cho từng chunk.

- **Issue 4: AI Exam Scanner (`POST /api/scan_exam_page`)**:
  - Nhận 1–5 ảnh chụp trang đề (PNG, JPG, WEBP) hoặc file PDF.
  - Nhận diện văn bản bố cục cao cấp qua Google Cloud Vision `DOCUMENT_TEXT_DETECTION`.
  - Tái cấu trúc thành đề thi chuẩn DOCX Formatter Playbook (`[PASSAGE]`, `[QUESTIONS]`, `[BLANK]`, `*answers`...) qua Vertex AI `gemini-2.5-pro`.
  - Biên dịch in-memory thành tài liệu DOCX và nạp qua `parse_docx_to_quiz`, đảm bảo 100% tính tương thích.
  - Frontend Exam Builder: Bổ sung nút quét thông minh `tx("Quét ảnh/PDF đề (AI)", "Scan Exam Image/PDF (AI)")` ở cả Exam Library Toolbar và Passage Toolbar (zero emojis, icon SVG scan, xử lý gộp đề hoặc tạo đề mới).

- **Issue 5: Tiêu đề Caching Edge CDN & Byte Range**:
  - Bổ sung `Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable` và `Accept-Ranges: bytes` trên `/api/audio/...`, `/api/exam-media/...`, `/api/exam-generation/media/...`, và metadata khi hoàn tất upload Firebase Storage. Giúp CDN cache vĩnh viễn và trình duyệt tua audio tức thì.

- **Issue 6: Triển khai Scale-to-Zero Cloud Run**:
  - `Dockerfile`: base `python:3.11-slim`, cài đặt `ffmpeg`, `curl`, `ca-certificates`, `uvicorn[standard]`, `imageio-ffmpeg`.
  - `.dockerignore`: loại bỏ `node_modules`, `dist`, `.git`, `tests`, `__pycache__`...
  - `deploy_cloud_run.sh`: script triển khai với cờ `--region asia-southeast1`, `--min-instances=0` (scale-to-zero, $0 chi phí khi không có request), `--max-instances=4`, `--cpu=2`, `--memory=2Gi`, `--timeout=900`, `--concurrency=40`, `--cpu-throttling`.

## Sửa lỗi URL Firebase Storage (`&amp;token=`), Giao diện Gắn nhãn Sơ đồ Chuẩn IELTS CBT & Thu hẹp Lightbox Zoom — 2026-10-15

- **Issue 1: Sửa triệt để lỗi ảnh Firebase Storage bị hỏng URL (`&amp;token=` -> HTTP 403 Forbidden)**:
  - *Nguyên nhân*: Trong `api/index.py` tại `process_block`, hàm `paragraph_to_html` chuyển đổi ký tự `&` thành `&amp;`. Khi bóc tách `text_lines`, regex `<[^>]+>` chỉ xóa thẻ HTML mà không gọi `html.unescape`, khiến query string của Firebase Storage như `?alt=media&token=...` bị lưu trữ dưới dạng `&amp;token=...` vào Firestore. Khi React render `<img src={url} />`, trình duyệt lại tiếp tục escape thành `&amp;amp;token=...`, khiến Firebase Storage từ chối truy cập và báo lỗi 403 Forbidden làm hỏng hình ảnh.
  - *Giải pháp triệt để*:
    - Backend `api/index.py`: Thêm `html.unescape` vào toàn bộ các luồng bóc tách URL ảnh (`text_lines.append(html.unescape(re.sub(r'<[^>]+>', '', h)).strip())`, `group_image_url`, `fallback_image_url`, `process_map_drag_block`, `process_diagram_label_block`, `parse_docx_writing_tasks`, và `ai_feedback`).
    - Frontend (`ACTIVE_EXAM.txt`, `REVIEW_QUIZ.txt`, `WritingFeedback.tsx`): Khai báo helper chuẩn hóa `cleanMediaUrl = (url: any) => String(url || "").replace(/&amp;/gi, "&").trim()` và bọc toàn bộ các thuộc tính `src` của ảnh sơ đồ, bản đồ và biểu đồ. Nhờ đó, ngay cả các đề thi cũ đã import và lưu sẵn trong Firestore với `&amp;` cũng tự động hiển thị mượt mà ngay lập tức mà không cần import lại DOCX.
    - Unit test tự động: Bổ sung `test_firebase_storage_image_url_unescaped` trong `tests/test_manual_explanations.py`.

- **Issue 2: Loại bỏ Zoom khỏi Sơ đồ Reading/Listening — Giữ Zoom Lightbox DUY NHẤT ở Writing Task 1**:
  - *Quy chuẩn*: Tính năng click-to-zoom phóng to toàn màn hình CHỈ được áp dụng cho biểu đồ Writing Task 1 (tại màn hình chấm giáo viên `src/WritingFeedback.tsx` và màn hình xem lại của học sinh `src/components_split/REVIEW_QUIZ.txt`).
  - *Thay đổi*: Gỡ bỏ nút "Bấm để phóng to" / "Click to zoom", hiệu ứng `cursor: zoom-in`, viền khung xám placeholder và state phóng to modal khỏi toàn bộ các sơ đồ/bản đồ Reading/Listening trong `src/components_split/ACTIVE_EXAM.txt` và `src/components_split/REVIEW_QUIZ.txt`. Sơ đồ trong phòng thi và review kết quả được hiển thị trực tiếp, sắc nét với `max-width: 100%; height: auto; object-fit: contain;`.

- **Issue 3: Chuẩn hóa Giao diện Kéo Thả Sơ đồ Kèm ảnh (External Diagram Drag) theo IELTS Máy tính Chính thức**:
  - *Cột trái (Minh họa trực quan)*: Hiển thị trực tiếp hình ảnh sơ đồ/bản đồ sạch (`<img>`), không bọc khung placeholder giả lập, không nút zoom.
  - *Cột phải (Các hàng câu hỏi 21–26)*:
    - Loại bỏ viền thẻ bao quanh (`border: none; background: transparent; padding: 0;`).
    - Loại bỏ số thứ tự câu hỏi ở đầu hàng và xóa bỏ marker `[21]` thừa khỏi văn bản nhãn, chỉ hiển thị đúng nhãn nội dung gốc (ví dụ: `Cooling Tower`, `Weather Station`).
    - Đặt ô thả nét đứt inline ngay bên phải nhãn câu hỏi (`min-width: 165px; min-height: 34px; border: 1.5px dashed #334155; border-radius: 5px; background: #ffffff;`).
    - Khi chưa điền: Hiển thị số thứ tự câu hỏi in đậm (`21`, `22`...) nằm ở giữa bên trong ô nét đứt.
    - Khi đã thả đáp án: Hiển thị pill lựa chọn màu xanh viền đậm (`border: 1.5px solid #2563eb; background: #eff6ff; color: #1e3a8a;`) kèm tiền tố chữ cái (`F. old air is removed`).
    - Đặt nút gắn cờ/đánh dấu (bookmark/flag) nằm inline trực tiếp ngay bên phải mỗi ô thả.
  - *Ngân hàng Lựa chọn Kéo thả (Draggable Option Bank)*:
    - Loại bỏ hoàn toàn tiêu đề thừa (không in `"LABEL THE DIAGRAM BELOW."` hay `rightTitle`) và không bọc khung xám bao quanh.
    - Đặt ngay bên dưới danh sách câu hỏi theo bố cục flex-wrap gọn gàng (`display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px;`).
    - Các thẻ lựa chọn kéo thả giữ nguyên tiền tố chữ cái (`A. ...`, `B. ...`).

## Hỗ trợ Giải thích Đa đoạn [EXPLANATION], Sơ đồ Kèm ảnh Bên ngoài Side-by-Side & Lightbox Zoom Modal — 2026-10-15

- **Issue 1: Hỗ trợ Giải thích Đa đoạn `[EXPLANATION]` (Backend Parser -> Frontend Review)**:
  - *Nguyên nhân cũ*: `RE_MANUAL_EXPLANATION` trong `api/index.py` chỉ bắt đoạn đầu tiên chứa thẻ `[EXPLANATION]`. Các đoạn văn giải thích tiếp theo (paragraph 2, 3...) bị rớt xuống phần đọc câu hỏi kế tiếp (`current_q["text"] += f" <div>{h_line}</div>"`), làm ô nhiễm đề bài hoặc bị mất nội dung. Khi trích xuất giải thích bổ sung (supplement DOCX), `current_parts` bị nối bằng dấu cách `" "` thay vì `"\n\n"`. Ở frontend (`REVIEW_QUIZ.txt`), `rvRenderExplain` dùng regex xóa toàn bộ dấu ngắt dòng `\s{2,}` thành 1 khoảng trắng, và `rvRenderManualExplanationCopy` hiển thị toàn bộ trong 1 thẻ `<div>` duy nhất mà không tách `<p>`.
  - *Giải pháp triệt để*:
    - Backend `api/index.py`: Mở rộng `RE_MANUAL_EXPLANATION` hỗ trợ cả số đơn lẫn dải số (`21`, `21-24`, `21, 22`). Hàm `parse_manual_explanation_text` chuyển đổi các ngắt khối HTML (`</p>`, `<br>`, `</div>`) sang `\n`, chuẩn hóa khoảng trắng ngang và bảo toàn `\n\n` giữa các đoạn văn. Thêm `active_explanation_targets` trong `process_block`, `process_map_drag_block`, `process_flow_drag_block`, `process_diagram_label_block`, và `parse_docx_to_quiz` để tự động ghép các đoạn văn tiếp theo (continuation paragraphs) vào lời giải thích của câu hỏi hiện hành (ngăn chặn 100% việc rò rỉ vào `question.text`). `extract_docx_manual_explanations` ghép các đoạn bằng `"\n\n".join(current_parts)`.
    - Frontend `src/App.template.tsx` & `src/components_split/REVIEW_QUIZ.txt`: `parseManualExplanation` bảo toàn ký tự ngắt dòng `\n\n`. `rvRenderExplain` chỉ thu gọn khoảng trắng ngang `[ \t]{2,}` và chuẩn hóa `\n{3,}` thành `\n\n`. `rvRenderExplanationCopy` và `rvRenderManualExplanationCopy` tách mảng đoạn theo `/\n+/` và render từng đoạn bằng `<p className="rv-explain-p">` riêng biệt với khoảng cách hợp lý.
    - Bộ test tự động: Bổ sung 4 unit test trong `tests/test_manual_explanations.py` kiểm chứng multi-paragraph explanation từ cả file DOCX chính và supplement DOCX.

- **Issue 2: Giao diện Gắn nhãn Bản đồ/Sơ đồ Kèm ảnh Bên ngoài (External Diagram Labelling Side-by-Side)**:
  - *Nguyên nhân cũ*: Khi đề thi có sơ đồ/bản đồ nhưng các vị trí điền khuyết nằm ở bên ngoài hoặc bên cạnh ảnh (không có tọa độ `[SLOTS]` hay hộp `[BOX]`), parser trước đây có thể bỏ qua hoặc chỉ hiển thị như câu hỏi thông thường bị tách rời khỏi hình ảnh tham chiếu.
  - *Giải pháp triệt để*:
    - Backend `api/index.py`: Nhận diện đường dẫn ảnh nhóm `IMAGE: <url>` và `diagramImageUrl` / `groupImageUrl` trong `[DRAG]`, `[BLANK]`, `[MATCHING]`. Bổ sung fallback tự động trong `process_map_drag_block` (khi không có `[SLOTS]`) và `process_diagram_label_block` (khi không có `[BOX]`) chuyển tiếp sang `process_block(..., fallback_image_url=image_url)`. Tự động nhận diện `OPTIONS:`, bổ sung marker `[xx]` nếu tác giả quên viết trong câu drag, và ánh xạ `*Answer` chuẩn xác vào danh sách options.
    - Frontend `ACTIVE_EXAM.txt`: Tích hợp bố cục lưới 2 cột (`.idp-external-diagram-grid`):
      - Cột trái: Card hình ảnh dính (`sticky`) hiển thị sơ đồ/bản đồ trực quan, hỗ trợ con trỏ `zoom-in` và huy hiệu hover xem kích thước lớn.
      - Cột phải: Các hàng câu hỏi kéo thả với dropzone nét đứt (`.idp-external-diagram-drop-target`) hoặc ô điền từ `BLANK`, theo sau ngay bên dưới là ngân hàng lựa chọn kéo thả (`.idp-external-diagram-bank-section`).
      - Tách ảnh khỏi context text (`displaySafeContext`) để tránh hiển thị ảnh trùng lặp 2 lần.
    - Frontend `REVIEW_QUIZ.txt`: Hiển thị ảnh sơ đồ tham chiếu dính kèm nhãn xem ảnh và nút phóng to trực quan trong phần xem lại kết quả bài thi.
    - Frontend `EXAM_BUILDER.txt`: Bổ sung ô nhập URL ảnh sơ đồ/minh họa (`groupImageUrl`) cho các nhóm câu hỏi `BLANK`, `DRAG_DROP`, `SHORT_ANSWER` kèm ảnh xem trước và nút xóa 1-click.

- **Issue 3: Modal Lightbox Phóng to Ảnh Biểu đồ Task 1 & Sơ đồ Đề thi (Click-to-Zoom Lightbox Modal)**:
  - *Nguyên nhân cũ*: Ảnh biểu đồ Task 1 trong Writing Review/Feedback và ảnh sơ đồ trong Exam/Review bị giới hạn kích thước trong container khiến học sinh và giáo viên khó đọc chi tiết các số liệu nhỏ, nhãn trục hoặc ghi chú trên bản đồ.
  - *Giải pháp triệt để*:
    - `src/WritingFeedback.tsx`: Thêm hiệu ứng hover `cursor: 'zoom-in'`, huy hiệu "Bấm để phóng to" (`tx('Bấm để phóng to', 'Click to zoom')`), và modal Lightbox toàn màn hình qua `createPortal(..., document.body)` với hiệu ứng làm mờ nền (`backdropFilter: 'blur(8px)'`), nút đóng SVG, phím tắt `Escape` và sự kiện click ra ngoài để đóng nhanh.
    - `src/App.template.tsx`, `ACTIVE_EXAM.txt`, `REVIEW_QUIZ.txt`: Tích hợp modal Lightbox tương tự qua `createPortal` cho tất cả ảnh sơ đồ, bản đồ và hình ảnh tham chiếu trong phòng thi và phòng xem lại.

- **Hỗ trợ Mốc thời gian Dải `[mm:ss - mm:ss]` & Điều hướng Transcript Listening Đa năng**:
  - *Regex & Chuẩn hóa Parser*: Mở rộng `RE_MANUAL_TIMESTAMP` và `TIMESTAMP_TOKEN_RE` nhận diện cả mốc đơn `[mm:ss]` và mốc dải `[mm:ss - mm:ss]` với mọi biến thể gạch nối (Word en-dash `–`, em-dash `—`, minus `−`, `~`, `to`) và định dạng giờ `hh:mm:ss`. Lưu trữ cả `startTime` và `endTime` trong `ManualExplanationTimestamp`.
  - *Bảo toàn Dữ liệu Firestore*: `parseManualExplanation` gộp các mốc có sẵn từ `value.parsedTimestamps` với mốc bóc tách mới, chống mất mốc thời gian của bài thi cũ.
  - *Giao diện Review Listening*:
    - Hỗ trợ transcript từ cả `quiz.transcript` và DOCX `[PASSAGE]` (`passageHtml`).
    - Bóc tách block transcript hỗ trợ tiêu đề mốc thời gian dạng `[mm:ss - mm:ss]` hoặc `(mm:ss - mm:ss)`, lưu `data-rv-transcript-start` và `data-rv-transcript-end`. Nếu transcript là hội thoại thông thường không có header mốc, tách theo đoạn văn `\n+` để tính năng locate quote hoạt động mượt mà.
    - `rvJumpToTranscript` hỗ trợ dải mốc, ưu tiên tìm theo quote (độ dài >= 4), sau đó tìm block khớp hoặc bao phủ dải mốc, dùng TreeWalker highlight chính xác cụm quote xuyên qua các thẻ con `<strong>`, và cuộn êm vào giữa màn hình.
    - Trong lời giải thích của giáo viên (`rvRenderManualExplanationCopy` và modal Why), render mốc thời gian thành các huy hiệu inline badge (`.rv-review-action-time`) cho phép click tua audio trực tiếp.

## Định tuyến Đánh giá IELTS Writing Sang Mô hình Suy luận/Đa phương tiện & Hiệu chuẩn Chống Giảm Điểm Oan (Anti-Band Deflation) — 2026-10-15

- **Bộ định tuyến chuyên dụng `_writing_eval_chat`**:
  - Không đi qua bộ định tuyến `_groq_chat` thông thường (vốn dùng `llama-3.1-8b-instant` / `llama-3.3-70b-versatile`).
  - Phân tầng ưu tiên 3 cấp:
    - **Tier 1 (Tối ưu nhất - Đa phương tiện & Suy luận cao)**: Google Gemini (`GEMINI_API_KEY`, `GEMINI_API_KEY_2`, `GOOGLE_API_KEY`). Ưu tiên mô hình `gemini-2.5-pro` (hoặc `GEMINI_WRITING_MODEL`), sau đó fallback `gemini-2.5-flash`.
    - **Tier 2 (Suy luận Groq 120B/70B)**: `GROQ_API_KEY` (1..4) với mô hình `openai/gpt-oss-120b` hoặc `GROQ_REASON_MODEL`, fallback `llama-3.3-70b-versatile` với `reasoning_effort="high"`. Loại trừ hoàn toàn `llama-3.1-8b-instant`.
    - **Tier 3 (Suy luận Cerebras 120B)**: `CEREBRAS_API_KEY` với `CEREBRAS_MODEL` (`gpt-oss-120b`, `llama-3.3-70b`) với `reasoning_effort="high"`.
- **Nâng cấp `_gemini_chat_once` cho Gemini 2.5 với `thinking_budget` & Thị giác Biểu đồ Task 1 (`image_part`)**:
  - Cho phép native thinking trên `gemini-2.5-pro` hoặc `thinkingBudget: max(1024, thinking_budget)` khi có budget. Trên `gemini-2.5-flash`, đặt `thinkingBudget: thinking_budget` khi `thinking_budget > 0` và `thinkingBudget: 0` khi `thinking_budget == 0`.
  - Tự động cộng bù `effective_max_tokens = max_tokens + thinking_budget` để token suy luận không chiếm đoạt độ dài tối đa dẫn đến cắt cụt JSON (`PROVIDER_TRUNCATED_OUTPUT`).
  - Lọc bỏ candidate parts có cờ `part.get("thought") is True` khi ghép chuỗi kết quả cuối cùng.
  - Hỗ trợ tham số `image_part`: Giải quyết tự động URL biểu đồ Task 1 (`mediaUrl` dạng Base64 data URL, asset nội bộ Firebase Storage `media_[a-f0-9]{24}`, hoặc remote URL) qua `_resolve_image_base64_part` và truyền trực tiếp vào `inlineData` của Gemini API để giám khảo AI đối chiếu chính xác số liệu, xu hướng, bản đồ hoặc quy trình biểu đồ thực tế.
- **Hiệu chuẩn Thước đo Giám khảo IELTS May 2023 & Triệt tiêu Định kiến Giảm điểm (Anti-Deflation Guardrails)**:
  - Khắc phục lỗi chí mạng: Prompt cũ ép AI phải tìm đủ 5-10 lỗi bắt buộc trước khi cho điểm, dẫn đến hiện tượng "bịa lỗi" (hallucinated errors) và ép một bài luận đạt chuẩn Band 8.0 xuống Band 6.0 (do schema neo sẵn con số 6.0).
  - Khử hoàn toàn thiên kiến neo điểm (Schema Anchoring Bias): Thay thế toàn bộ số `6.0` trong template JSON của system prompt bằng `<number 1.0-9.0>`.
  - Quy trình độc lập 2 pha: Giám khảo AI đánh giá điểm 4 tiêu chí (TA/TR, CC, LR, GRA) độc lập dựa trên năng lực thực chất, sau đó mới gắn chú thích (annotations) tương xứng với Band điểm đã xác định.
  - Phân loại chú thích nghiêm ngặt: Phân định rạch ròi giữa `error` (lỗi sai ngữ pháp/từ vựng thực sự), `awkward` (diễn đạt tự nhiên hơn), `upgrade` (gợi ý nâng Band 8+) và `praise` (điểm sáng bài viết). Tuyệt đối không hạ điểm tiêu chí chỉ vì xuất hiện các gợi ý nâng cấp (`upgrade`).
  - Bổ sung quy tắc làm tròn điểm IELTS chính thức `_ielts_round_band(avg)`: Phần thập phân `< 0.25` làm tròn xuống số nguyên, `>= 0.25` và `< 0.75` làm tròn thành `.5`, `>= 0.75` làm tròn lên số nguyên kế tiếp.

## Toàn diện Hóa Bản địa Song ngữ (Bilingual EN / VI Localization Parity) & Triệt tiêu Rò rỉ Chuỗi Tiếng Việt — 2026-10-15

- **Thiết lập Động cơ Song ngữ Tương tác tức thì `tx(vi, en)`**:
  - Khai báo helper toàn cục `const isVi = String(i18n.language || '').toLowerCase().startsWith('vi')` và `const tx = (vi: string, en: string) => (isVi ? vi : en)` trong phạm vi `IeltsSupremeOS` (`src/App.template.tsx`) và `src/WritingFeedback.tsx`.
  - Các hợp phần `components_split/*.txt` tự động kế thừa scope `isVi` và `tx(vi, en)` từ `App.template.tsx` sau khi gộp qua `compile_app.py`, không cần import rời rạc.
  - Chuyển đổi ngôn ngữ tức thời (Instant Re-render) trên toàn bộ ứng dụng mà không cần tải lại trang.
- **Bản địa hóa 100% Không gian Chấm & Review Writing (`src/WritingFeedback.tsx`)**:
  - Giao diện chấm giáo viên & review học sinh: thanh công cụ điều hướng, trạng thái lưu nháp (`Lưu nháp` / `Save draft`), trạng thái xuất bản (`Publish cho học sinh` / `Publish to student`), chế độ xem bài viết (Bản gốc, Diff sửa trực tiếp, Bản sửa hoàn chỉnh, Bài mẫu Band 8+).
  - Thanh đo đạc X-Ray: từ vựng, đoạn, câu, số từ/câu, radar lặp từ, kiểm tra ngưỡng từ.
  - Khung 4 tiêu chí chấm điểm (TA/TR, CC, LR, GRA) kèm ghi chú giáo viên, 3 nút thắt cần cải thiện (Bottlenecks), nhận xét tổng quan.
  - Floating Selection Composer & Hover Cards: các pill gán lỗi nhanh (`Chưa tự nhiên`, `Nâng Band`, `Điểm sáng`, `Lỗi ngữ pháp`), trợ lý AI Selection Critique, nút lưu sổ từ vựng Spaced Repetition 1-click.
  - Tài liệu học thuật Vector PDF Dossier (`buildVectorPdfDossierHtml` & `buildDossierAnnotatedEssayHtml`): Tự động truyền cờ `isVi` vào bộ sinh HTML, chuyển đổi toàn bộ tiêu đề trang, bảng tiêu chí, nhãn phân loại chú thích lỗi và thông báo trạng thái sang tiếng Anh khi in ở chế độ EN.
- **Bản địa hóa 100% Student Portal (`src/components_split/STUDENT_PORTAL.txt`)**:
  - Thêm helper `formatCosmeticDisplayName(rawName)`: dịch động các vật phẩm gacha, danh hiệu, khung avatar hoàng kim, linh thú sống động khi hiển thị trên giao diện học viên mà không làm thay đổi khóa định danh gốc trong cơ sở dữ liệu.
  - Cửa hàng đổi thưởng & Gacha Mystery Box: thông báo trúng thưởng, chi phí, hộp quà rỗng, cảnh báo dùng vật phẩm với giáo viên (`handleUseItem`), xác nhận mở bài thi trên thiết bị khác.
  - Sổ cái Tổng quan: các chỉ số đo lường (`Cấp độ & EXP`, `Thời gian làm bài & học`, `Luyện thi hôm nay`, `Xem tất cả kết quả`).
  - Sổ từ vựng Spaced Repetition & Daily Expressions: nút `+ Lưu vào sổ tay`, trạng thái `Đã trong sổ tay`, chip phát âm.
- **Bản địa hóa 100% Exam Builder, Active Exam, Students, Live Arena & SEB Guide**:
  - `EXAM_BUILDER.txt`: Tên đề thi mới, câu hỏi mới, cấu hình gói bài thi thật (`Toàn bộ học sinh` / `Chọn học sinh`, `Mở từ`, `Đóng lúc`, `Xuất bản gói thi`, `Tên hiển thị`, `Mật khẩu`), modal quản lý thư mục (`Tên thư mục mới`, `Hủy`).
  - `ACTIVE_EXAM.txt`: Nút đóng cảnh báo hết giờ (`Đã hiểu` / `Dismiss`), đóng thông báo chuông (`Đóng & Đánh dấu đã đọc`).
  - `STUDENTS.txt`: Mẫu sao chép kết quả thi IELTS CBT, nhãn/placeholder tên quà và chi tiết quà tặng, tin nhắn cảnh báo học phí SMS & cảnh báo đỏ trên màn hình học sinh.
  - `SEB_GUIDE.txt`: Bản dịch hoàn chỉnh 4 bước hướng dẫn cài đặt Safe Exam Browser (SEB) bằng tiếng Anh khi người dùng chọn EN.
- **Kiểm thử & Rà soát Tự động (Zero-leak Automated Verification)**:
  - Hoàn tất quét toàn bộ codebase split components, xác nhận 0 chuỗi tiếng Việt người dùng (user-facing) bị bỏ quên.
  - `python compile_app.py` và `npx tsc -b` đều vượt qua thành công tuyệt đối (exit code 0, không có lỗi TypeScript).

## Đại tu Giao diện Học viên (Student Portal), Sửa lỗi Unlimited Attempts, Format Coins & Xếp biểu đồ tiến độ chuẩn thời gian — 2026-10-14

- **Đại tu toàn diện Student Portal theo hệ thống thiết kế Manuscript Editorial**:
  - Mở rộng container chính `<main>` lên `maxWidth: 1120px` (tránh lãng phí 50% không gian màn hình desktop).
  - Tích hợp 6 tab điều hướng desktop (`Overview`, `Test Room`, `Quests`, `Vocabulary`, `Progress`, `Rewards`) vào ngay thanh navbar dính (`sticky <nav>`) với mẫu Segmented Pill Bar gọn gàng, thanh lịch; giữ nguyên thanh tabbar dính đáy trên mobile.
  - Lời nhắc giáo viên (`me.privateMessage`): Thay thế khung đỏ báo động bằng Manuscript Callout có viền trái màu accent (`borderLeft: 3px solid C.accent`), có nút tắt (dismiss) ghi nhớ trạng thái theo từng tin nhắn trong `localStorage`.
  - Student Masthead: Định dạng số dư OS Coins thông minh qua `formatCoins` (phân tách hàng nghìn, rút gọn `1.2M`, `30.0B` kèm tooltip số dư đầy đủ); hiển thị huy hiệu cấp độ mono `Lv.X` kèm tỷ lệ phần trăm EXP tiến độ.
  - Tab Tổng quan (`home`): Cấu trúc lại thành Sổ cái Manuscript 4 cột (`Điểm trung bình`, `Bài thi đã hoàn thành`, `Tổng thời lượng học`, `Cấp độ & EXP`) và layout "Bàn học hôm nay" 2 cột (Cột trái: Lịch học kế tiếp / Luyện thi nhanh + Mục tiêu Band; Cột phải: Bàn ôn tập từ vựng Spaced Repetition + Kết quả bài thi gần nhất).
  - Tab Phòng thi (`exams`):
    - Gỡ bỏ viền cam báo động `2px solid C.warn`, mở rộng ô tìm kiếm đề thi.
    - Căn chỉnh thanh lọc kỹ năng `Listening`, `Reading`, `Writing` rộng rãi với pill đếm mono (`Listening 2`, `Reading 44`, không còn bị dính chữ).
    - **Sửa dứt điểm lỗi `Attempts: 1/9007199254740991` và khóa đề luyện tập**: Nhận diện đề thi thử / luyện tập (`isPracticeQuiz` hoặc `practiceMode` hoặc `maxAttempts >= 99`), hiển thị rõ ràng `Số lần đã làm: X (Không giới hạn)` / `Attempts: X (Unlimited)`, và tuyệt đối không bao giờ khóa truy cập phòng thi của đề luyện tập.
  - Tab Chuyên đề (`quests`): Chuyển trạng thái `closed` sang tông xám đá `#64748B` thay vì màu đỏ báo động; căn chỉnh milestone reward tags bọc linh hoạt (`flex-wrap`).
  - Tab Từ vựng (`vocab`):
    - Thay thế idiom tĩnh "do/work wonders" bằng bộ 16 Thành ngữ & Cụm từ học thuật IELTS Band 7.5+ (`DAILY_EXPRESSIONS`) luân phiên theo ngày, hỗ trợ phát âm chuẩn và nút `+ Lưu vào sổ tay` trực tiếp vào `vocabNotebook` với cơ chế đồng bộ chống mất dữ liệu.
    - Chuyển đổi các ký tự text symbol `●/○` trong Leitner boxes thành các thẻ CSS dot sắc nét.
  - Tab Tiến độ (`progress`):
    - Bổ sung bộ lọc kỹ năng (`All`, `Listening`, `Reading`, `Writing`) cho biểu đồ tiến độ `BandTrendChart`.
    - Triệt tiêu lỗi nhảy ngày lộn xộn trong biểu đồ (`1/8/2026 -> 21/6/2026 -> 3/7/2026`) bằng helper `parseQuizResultDateMs` phân tích cú pháp thời gian thực (hỗ trợ `hh:mm:ss dd/mm/yyyy`, `dd/mm/yyyy`, ISO timestamps) và sắp xếp biểu đồ tăng dần theo thời gian thực (Chronological order).
    - Danh sách kết quả thi được sắp xếp chuẩn xác từ mới nhất đến cũ nhất.
  - Tab Phần thưởng (`rewards`): Thay thế nút xoay neon nổi chói mắt bằng Manuscript Gacha Mystery Box banner sang trọng.
  - Tuân thủ nghiêm ngặt tiêu chuẩn **Zero Text Emojis**: Toàn bộ icon được chuẩn hóa sang inline SVG thông qua component `<Ico />`, loại bỏ toàn bộ ký tự text emoji `✓`, `★`, `♥`, `●`, `○`.

## Khôi phục Ảnh Biểu đồ Task 1 trên Web & Proxy Base64 Backend cho PDF Dossier — 2026-10-14

- **Khôi phục hoàn toàn hiển thị ảnh biểu đồ Task 1 trên giao diện Web**:
  - *Nguyên nhân gốc rễ*: Việc gắn `crossOrigin="anonymous"` trên thẻ `<img />` (và trong bộ nạp `new Image()`) khiến trình duyệt kích hoạt cơ chế kiểm tra CORS nghiêm ngặt (`Access-Control-Allow-Origin`). Do các máy chủ lưu trữ ảnh bên ngoài không trả về header CORS cho yêu cầu fetch/canvas, Chrome chặn hoàn toàn luồng tải ảnh — làm ảnh biểu đồ trên Web bị hỏng (icon lỗi) và kéo theo PDF bị trắng ảnh.
  - *Giải pháp*:
    1. Gỡ bỏ hoàn toàn thuộc tính `crossOrigin` khỏi toàn bộ các thẻ `<img />` hiển thị trên màn hình trong `src/WritingFeedback.tsx` (cả trong Task Prompt & Visual panel).
    2. Bổ sung `referrerPolicy="no-referrer"` trên các thẻ `<img />` nhằm tránh việc máy chủ ảnh chặn request do header `Referer`.
    3. Thêm hàm chuẩn hóa URL `normalizeChartUrl(rawUrl)` và `getApiBase()`: tự động nâng cấp `http://` lên `https://` trên môi trường web HTTPS để chống chặn Mixed Content; tự động bổ sung tiền tố backend `http://localhost:8000` cho các đường dẫn relative `/api/...` khi chạy trên localhost / dev.
    4. Căn chỉnh hiển thị ảnh biểu đồ Task 1 sắc nét, cân đối trong khung xem đề (`maxHeight: 280, maxWidth: '100%', objectFit: 'contain'`).
- **Bảo đảm 100% kết xuất ảnh biểu đồ trong Vector PDF Dossier qua Backend Proxy**:
  - *Nguyên nhân*: JavaScript phía trình duyệt bị giới hạn bởi Sandbox CORS khi vẽ ảnh chéo domain lên Canvas. Tuy nhiên, Python trên máy chủ backend hoàn toàn có thể đọc và chuyển đổi ảnh thành chuỗi Base64 tự do không phụ thuộc vào CORS của trình duyệt.
  - *Giải pháp*:
    1. Xây dựng endpoint nhẹ `GET /api/image_base64` trong `api/index.py`:
       - Kiểm tra hợp lệ URL đầu vào (chấp nhận `http://`, `https://`, `/api/exam-media/{asset_id}`, hoặc data URL).
       - Nếu là asset nội bộ `media_[a-f0-9]{24}`, đọc trực tiếp từ Firebase Storage store.
       - Tải dữ liệu ảnh bằng `urllib.request` kèm User-Agent chuẩn và timeout 10 giây, tự động nhận diện MIME type từ `Content-Type` hoặc phần mở rộng tệp.
       - Mã hóa Base64 và trả về `{"dataUrl": "data:image/...;base64,..."}`.
    2. Cập nhật `resolveChartImageForPdf` trong `src/WritingFeedback.tsx`:
       - Thu thập URL biểu đồ từ tất cả các trường dữ liệu (`activeTask.mediaUrl`, `quiz.sections[i]`, HTML prompt, DOM).
       - Gọi `GET /api/image_base64?url=...` (với timeout 6s) để lấy Data URL Base64 nhúng thẳng vào PDF.
       - Nếu proxy thất bại, an toàn fallback về URL trực tiếp đã chuẩn hóa.
    3. Trong template HTML của print `iframe`: render thẻ `<img id="pdf-dossier-chart-img" src="..." referrerpolicy="no-referrer" />` hoàn toàn KHÔNG có thuộc tính `crossorigin`. Động cơ in gốc của trình duyệt sẽ in tốt ảnh ngoài khi không bị ép CORS.
    4. Cơ chế đợi nạp ảnh nghiêm ngặt trước khi in: sử dụng `Promise.all` lắng nghe sự kiện `load`/`error` trên tất cả thẻ `<img>` trong iframe (timeout 5s) và chờ 300ms layout settle delay trước khi gọi `iframeWindow.print()`.

## Hạ tầng đồng bộ Firestore Đa thiết bị, Triệt tiêu giật cục 2s & Bền vững Thư mục Đề thi — 2026-10-14

- **Sửa dứt điểm lỗi mất trắng danh sách đề thi (`0 exams`) khi F5 / Hard Refresh**:
  - *Nguyên nhân gốc rễ*:
    1. Trong `applyQuizCatalogSnapshot`, lệnh `if (snap.metadata?.hasPendingWrites) return;` chặn nạp dữ liệu khi Firestore IndexedDB còn write nội bộ chưa xác nhận từ server. Khi người dùng vừa thao tác (kéo thả, sửa đề) rồi bấm F5, IndexedDB vẫn giữ cờ `hasPendingWrites`, khiến hàm return sớm và bỏ rơi kho đề thi, làm `quizzes` rỗng vĩnh viễn.
    2. Trong `applyWorkspaceSnapshot`, khi `quizCatalogMigratedRef.current === true`, biến `fallbackQuizzes` là `[]`, dẫn đến lệnh `setQuizCatalogState(recoveredQuizzes)` ghi đè danh sách đề thi thành rỗng.
    3. Việc lưu toàn bộ đối tượng `Quiz` khổng lồ vào `localStorage` khi di chuyển thư mục gây lỗi `QuotaExceededError` (>5MB), khiến trạng thái phục hồi bị khuyết hoặc hỏng.
  - *Giải pháp*:
    1. Gỡ bỏ hoàn toàn `if (snap.metadata?.hasPendingWrites) return;` trong `applyQuizCatalogSnapshot`, luôn xử lý `snap.docs` và bật cờ `quizCatalogReadyRef.current = true`.
    2. Bảo vệ `applyWorkspaceSnapshot`: Tuyệt đối không gọi `setQuizCatalogState([])` khi catalog đã migrate. Chỉ nạp `serverQuizzes` khi catalog chưa migrate, remote catalog chưa sẵn sàng và bộ nhớ đề hiện tại rỗng.
    3. Nâng cấp `mergeQuizCatalog`: Hợp nhất đề máy chủ và cục bộ theo ID, chọn bản ghi có `revision` cao hơn hoặc `updatedAt` mới hơn, tôn trọng mảng `deletedIds`.
    4. Tinh giản nhật ký lưu trữ `writePendingQuizWrite`: Với kho đề lớn (>250KB hoặc >3 đề), chỉ lưu bản patch siêu nhẹ gồm `{ id, folder, title, updatedAt, revision, isPatch: true }`, có thời hạn thu hồi tự động 24h trong `readPendingQuizWrite`.
- **Triệt tiêu hoàn toàn hiện tượng giật cục 2 giây (2-second UI revert jitter)**:
  - *Nguyên nhân gốc rễ*:
    1. Khi giáo viên bấm nút thao tác (thu học phí, đổi lịch học, chuyển đề), thao tác nhấp chuột hoặc đóng modal vô tình gây chu kỳ mất/nhận tiêu điểm cửa sổ (window blur/focus).
    2. Sự kiện `handleForeground` ngay lập tức kích hoạt `refreshCloudAfterForeground()` gọi `getDocFromServer(DB_DOC_REF)`. Do giao dịch Firestore của thao tác vừa bấm vẫn đang trên đường truyền (in-flight), lệnh đọc server này tải về dữ liệu cũ trước giao dịch, ghi đè lên React state lạc quan, gây hiện tượng UI nhảy về cũ 1-2 giây rồi mới giật lại mới.
    3. `applyWorkspaceSnapshot` chấp nhận các snapshot trung gian/chưa xác nhận từ server trong khi write cục bộ đang diễn ra.
  - *Giải pháp*:
    1. Chặn đứng snapshot trong `applyWorkspaceSnapshot` khi có write đang bay (`writeInFlightRef.current > 0 || Date.now() < suppressSnapshotUntilRef.current`) hoặc echo chưa xác nhận (`isUnconfirmedEcho && Date.now() - lastLocalMutationAtRef.current < 2000`).
    2. Thiết lập cửa sổ ổn định sau ghi `suppressSnapshotUntilRef.current = Date.now() + 1400` trong khối `finally` của `performSyncData`.
    3. Khóa bảo vệ `refreshCloudAfterForeground` và `handleForeground`: Hủy ngay lập tức nếu đang có ghi dở dang hoặc vừa có thao tác cục bộ trong vòng 2500ms (`writeInFlightRef.current > 0 || Date.now() - lastLocalMutationAtRef.current < 2500`).
- **Hợp nhất thực thể đa thiết bị & Cơ chế bia mộ (Tombstones)**:
  - Bổ sung helper `mergeEntityArray` hợp nhất các thực thể `history`, `schedules`, `transactions`, `examFolders`, `topicAssignments`, `realExamPackages`, `sharedLinks` theo `id`, giải quyết xung đột bằng `revision` và `updatedAt`.
  - Thiết lập danh sách bia mộ giới hạn bền vững: `deletedHistoryIds`, `deletedScheduleIds`, `deletedTransactionIds`, `examFolderTombstones`.
  - Trong `applyWorkspaceSnapshot`, tự động lọc tất cả mảng thực thể đến qua các bia mộ này để ngăn thiết bị chạy song song hồi sinh các mục đã xóa.
  - Bổ sung mã truyền bia mộ khi xóa lịch sử bài làm (`__deletedHistoryIds` trong `STUDENTS.txt` & `App.template.tsx`), xóa lịch học (`__deletedScheduleIds` trong `DASHBOARD.txt`), xóa giao dịch (`__deletedTransactionIds` trong `FINANCE.txt`).
  - Đóng dấu thời gian chuẩn `updatedAt: getTrueTime()` khi thu học phí cho học sinh (`STUDENTS.txt`).
- **Kiến trúc đường dẫn thư mục chuẩn hóa & Kéo thả bền vững**:
  - Viết helper thuần `normalizeFolderPath(rawPath: any): string` chuẩn hóa separator `/`, cắt khoảng trắng và loại bỏ slash thừa.
  - Áp dụng `normalizeFolderPath` xuyên suốt `src/App.template.tsx` và `src/components_split/EXAM_BUILDER.txt`.
  - Chuẩn hóa toàn diện logic thư mục: `handleCreateFolder`, `handleMoveOrRenameFolder`, `handleRenameFolder`, `handleDeleteFolder`, `handleMoveQuizzes`, `handleDropOnFolder`. Mọi thao tác di chuyển/đổi tên đều trích xuất đề bị ảnh hưởng từ `quizzesRef.current`, cập nhật `folder`, tăng `revision`, đóng dấu `updatedAt` và đồng bộ nguyên tử qua `__quizUpserts` (batch write trực tiếp vào collection `quizzes`) cùng mảng thư mục và `__examFolderTombstones` qua `syncData`.
  - Nâng cấp giao diện Exam Builder (`EXAM_BUILDER.txt`): Chuẩn hóa đường dẫn thư mục hiện tại (`currentPath`), hiển thị đếm số lượng đề và thư mục con đệ quy chính xác (`directAndNestedQuizCount`, `subFolderCount`), modal di chuyển thư mục và hỗ trợ kéo thả trực quan không bị rớt đề.
- **Nhật ký đồng bộ bền bỉ (Durable Sync Journaling)**:
  - Ghi nhận trạng thái lạc quan và theo dõi danh sách đột biến đang bay `inFlightMutationIdsRef`.
  - Cập nhật `flushPendingWorkspaceMutations`: Bỏ qua các bản ghi đang chạy, tăng biến đếm `retryCount`, và tự động loại bỏ các bản ghi lỗi sau 3 lần retry để tránh tắc nghẽn hàng đợi đồng bộ.

## Writing Feedback Floating Popovers, Smart Auto-Flip, Spring Motion & PDF Dossier Fix — 2026-10-14

- **Triệt tiêu hoàn toàn lỗi giật giật (Jitter / Flicker Loop) khi hover chú thích**:
  - *Nguyên nhân gốc rễ*: Trước đây, popover được render hoặc đo đạc dựa trên tọa độ cứng không đồng bộ layout, khi mở ở nửa dưới màn hình làm tràn chiều cao container/viewport gây sinh thanh cuộn, thanh cuộn đẩy văn bản dưới con trỏ chuột lệch sang trái 15px khiến kích hoạt ngay sự kiện `mouseleave` (ẩn card), ẩn card thì mất thanh cuộn khiến văn bản thụt lại dưới con trỏ kích hoạt lại `mouseenter` (vòng lặp giật vô tận).
  - *Giải pháp*:
    1. Đưa toàn bộ thẻ trôi (`Hover Annotation Card`, `Selection Quick Pill`, `Selection Composer Popover`) ra khỏi cây DOM của bài viết và gắn trực tiếp vào `document.body` qua `FloatingCardPortal` (`createPortal`, `position: fixed`, `zIndex: 1400`).
    2. Tự động đo đạc kích thước thực tế của card trước khi trình duyệt vẽ (`useLayoutEffect`), tính toán không gian khả dụng trên (`spaceAbove`) và dưới (`spaceBelow`).
    3. Luật tự động lật thông minh (`Smart Vertical Auto-Flip`): Tự động bật lên trên (`top`) khi không đủ không gian bên dưới (`spaceBelow < height + 10`) hoặc mục tiêu nằm ở 38% đáy màn hình (`anchorRect.bottom > vh * 0.62`), ngược lại mở xuống dưới (`bottom`).
    4. Kẹp biên an toàn (`Hard Viewport Clamping`): Giới hạn tọa độ trong khoảng cách an toàn `VIEWPORT_PAD = 14px`, triệt tiêu khả năng popover tràn mép màn hình.
    5. Căn chỉnh mũi tên định hướng (`10x10px Directional Caret Pointer` xoay 45 độ): Tự động khớp vào đỉnh hoặc đáy card trỏ chuẩn xác vào vị trí con trỏ/từ bôi chọn.
    6. Thuật toán chọn dòng văn bản nhiều dòng (`getTargetClientLineRect`): Khi cụm từ highlight bị ngắt dòng (wrapped text across multiple lines), `target.getClientRects()` sẽ chọn đúng dòng chứa hoặc gần nhất với tọa độ chuột `(e.clientX, e.clientY)` thay vì lấy toàn bộ bounding box khổng lồ bao trọn đoạn.
    7. Cầu nối chống rung chuột (`Debounced Hover-Intent Bridge`): Trì hoãn mở 60ms để tránh giật khi lướt chuột qua nhiều từ; duy trì mở 150ms khi rời chuột để người dùng kịp di chuột vào card bấm nút "Lưu vào Sổ từ vựng" hoặc xem Band 8+ rewrite; chuyển card tức thì (0ms) nếu đã có một card đang mở.
    8. Lắng nghe sự kiện cuộn/đổi kích thước màn hình (`scroll` capture phase & `resize`) và phím `Escape` để đóng popover mượt mà, không bị trôi lơ lửng ngoài màn hình.
  - *Chuyển động mượt mà (Editorial Spring Motion)*: Thêm CSS keyframes `@keyframes wfFloatInBottom` và `@keyframes wfFloatInTop` với đường cong gia tốc `cubic-bezier(0.16, 1, 0.3, 1)` và đổ bóng biên tập tinh tế (`box-shadow: 0 16px 38px -6px rgba(26, 23, 38, 0.18)`).
- **Sửa dứt điểm lỗi cắt chữ ("past" -> "pas", "millions" -> "millio") & mất mệnh đề (`Lossless Segmentation Engine`)**:
  - *Nguyên nhân gốc rễ*: Trước đây, `parseParagraphsWithOffsets` và các hàm chia đoạn tính offset bằng `currentOffset = paraEnd + 1`. Trong các bài viết có hai dấu ngắt dòng `\n\n` giữa các đoạn, offset bị trôi 1-2 ký tự sau mỗi đoạn khiến các ký tự cuối của quote bị cắt cụt (VD: `"past"` thành `"pas"`, `"millions"` thành `"millio"`). Đồng thời, việc gom các điểm cắt thành `Set<number>` và duyệt từng lát cắt làm rơi rụng các đoạn văn bản xen kẽ giữa các chú thích chồng lấn.
  - *Giải pháp*:
    1. Chuẩn hóa `parseParagraphsWithOffsets` dùng regex `([^\r\n]+)` để đo đạc chính xác tuyệt đối tọa độ `startOffset` và `endOffset` của từng đoạn theo đúng chuỗi gốc.
    2. Hàm `resolveAccurateCommentSpan`: Khôi phục chính xác vị trí quote thực tế trong văn bản (`end - start === quote.length`) với cơ chế dò chuỗi không phân biệt hoa thường và regex chịu dung sai khoảng trắng, loại bỏ hoàn toàn hiện tượng lệch độ dài.
    3. Bộ phân đoạn bảo toàn 100% (`buildLosslessParagraphSegments`): Chia đoạn thành các phân đoạn `PlainSegment` và `HighlightSegment` liền mạch, có kiểm tra nghiệm thu bất biến (invariant assertion) `reconstructed === rawText`. Nếu phát hiện bất kỳ ký tự nào bị mất, hệ thống tự động fallback về văn bản gốc nguyên vẹn.
    4. Toàn bộ các thẻ `<mark>` highlight và chỉ số chú thích `[1]`, `[2]` được ép kiểu `display: inline` (thay vì `inline-block`), cho phép trình duyệt ngắt dòng tự nhiên theo từ ngữ mà không bao giờ bị cắt xén biên ký tự.
- **Thay thế PDF ảnh mờ bằng Động cơ In Vector PDF (`Vector Print-to-PDF Engine`)**:
  - *Nguyên nhân gốc rễ*: `html2canvas` / `html2pdf.js` chụp màn hình thành ảnh bitmap/canvas rồi nén vào PDF, dẫn đến dung lượng nặng, chữ bị mờ nhòe khi phóng to, không bôi chọn sao chép văn bản được, và thường xuyên bị cắt ngang dòng chữ khi ngắt trang A4.
  - *Giải pháp*:
    1. Thay thế hoàn toàn bằng động cơ in vector qua hidden `iframe` (`exportPdfDossier` & `buildVectorPdfDossierHtml`).
    2. Tự động sinh tài liệu HTML vector độc lập với định dạng chuẩn `@page { size: A4 portrait; margin: 14mm 15mm; }`, hỗ trợ đầy đủ font Fraunces, Space Grotesk, Space Mono, và Inter.
    3. Hỗ trợ hiển thị ảnh biểu đồ Task 1 sắc nét (tự động preload và kiểm tra hoàn tất trước khi in).
    4. Trình bày 4 cột điểm tiêu chí nằm ngang cân đối kèm dải mô tả chuẩn IELTS.
    5. Bản bài viết học sinh hiển thị highlight inline kèm số thứ tự đồng bộ `[1]`, `[2]`, liên kết chuẩn xác với Bảng đối chiếu sửa lỗi chi tiết có gắn class `.pdf-no-break` để ngăn ngắt trang giữa hàng.
    6. Tự động gọi `iframe.contentWindow.print()` sau khi phông chữ và ảnh đã sẵn sàng, xuất ra file PDF vector chữ nét tuyệt đối ở mọi độ phân giải.
- **Xóa bỏ hoàn toàn "Silent Wait" khi Publish và Lưu nháp (Save Draft)**:
  - Bổ sung trạng thái `actionStatus: 'idle' | 'saving_draft' | 'publishing' | 'saved_ok' | 'published_ok' | 'error'` và `statusMessage`.
  - Hiển thị dải tiến trình hairline động `.wf-sync-progress-line` trên cùng màn hình khi đang lưu hoặc xuất bản.
  - Các nút thao tác chuyển sang trạng thái disabled và hiển thị icon xoay mượt mà (`<Ico name="loader" className="wf-spin" />`).
  - Thay thế hộp thoại chặn `alert()` của trình duyệt bằng thanh thông báo trạng thái nổi tinh gọn, tự động ẩn sau 4 giây.
- **Tối ưu thanh công cụ chế độ xem (View Toolbar) & Tiêu chí**:
  - Ép `flexWrap: 'nowrap'` cho thanh công cụ chế độ xem (`Bản gốc`, `Sửa trực tiếp (Diff)`, `Bản sửa hoàn chỉnh`, `Bài mẫu Band 8+`), không bị rớt dòng trên màn hình laptop tiêu chuẩn.
  - Hiển thị nhãn tiêu chí chuẩn `TA / TR` thay cho mã enum kỹ thuật `TA_TR`.
  - Tích hợp nút "Thu gọn đề bài" tinh gọn trên ngăn kéo đề bài & biểu đồ (`Prompt & Visual Drawer`).
- **Nhúng trực tiếp ảnh biểu đồ Task 1 vào PDF qua Base64/Canvas (`Force-Embed Chart Image via Base64/Canvas`)**:
  - *Nguyên nhân*: Trang in `iframe` (`about:blank`) trước đây có thể không tải kịp ảnh từ URL ngoài trước khi hộp thoại in xuất hiện, hoặc không tìm thấy URL do ảnh nằm ở field khác (`sections[0].images[0]`, `passage`, hoặc bị unmount khi thu gọn đề bài).
  - *Giải pháp*:
    1. Vét URL ảnh qua hàm `resolveChartImageForPdf`: thu thập từ tất cả nguồn khả dĩ (`activeTask.mediaUrl`, `imageUrl`, `chartUrl`, `diagramImageUrl`, `mapImageUrl`, `quiz.sections[i].mediaUrl/images`, `quiz.questions[i].imageUrl`, chuỗi HTML `<img src="..." />` trong `prompt`/`instructions`/`passage`).
    2. Duy trì thẻ `<img>` trên DOM ngay cả khi thu gọn ngăn kéo đề bài (dùng CSS `height: 0; overflow: hidden; opacity: 0; pointer-events: none;` với cờ `data-wf-chart-img="true"` và `crossOrigin="anonymous"`), giúp trình duyệt tải sẵn ảnh ngầm.
    3. Bộ chuyển đổi `imageToDataUrl` 4 bước: (A) Vẽ trực tiếp từ `<img>` trên DOM lên `<canvas>` lấy `data:image/png;base64,...` (0ms delay); (B) `fetch()` + `FileReader` đọc Blob; (C) `new Image()` kèm `crossOrigin="anonymous"` vẽ canvas; (D) Fallback URL tuyệt đối kèm thẻ `<base href="${origin}/">` trong `<head>`.
    4. Render khối `.dossier-chart-box` cố định ngay dưới nội dung đề bài tại Mục 1 của PDF, không cắt bỏ `<img>` trong HTML prompt.
    5. Đợi toàn bộ ảnh trong iframe decode thành công (`await img.decode()`, `img.complete && img.naturalWidth > 0`) cộng thêm 250ms paint settle delay trước khi kích hoạt `print()`.
- **Thanh lọc 100% Emojis & Ký tự text symbol (Zero-Emoji Compliance)**:
  - Loại bỏ hoàn toàn các emoji Unicode (`🎉`, `✅`) và ký tự text (`✓`, `×`, `⚠`) trong toàn bộ `src/WritingFeedback.tsx`.
  - Thay thế bằng các icon SVG nội tại chuẩn nét (`<Ico name="checkBadge" />`, `<Ico name="close" />`, `<Ico name="alert" />`, và các phần tử `<svg>` inline), bảo đảm giao diện nhất quán theo đúng chuẩn Manuscript Editorial Desk.
- **Sửa lỗi tính điểm Overall Band khi chỉ chấm 1 task (`Single-Task & Partial Band Calculation`)**:
  - *Nguyên nhân*: Công thức cũ tính cứng `(T1 + T2 * 2) / 3`, khi Task 2 chưa chấm (`T2 = 0`) hoặc bài thi chỉ có Task 1 (`T1 = 6`, `T2 = 0`), hệ thống ra `(6 + 0) / 3 = 2.0`.
  - *Giải pháp*:
    1. Nếu cả 2 task có band `> 0`: áp dụng công thức chính thức của IELTS `Math.round(((T1 + T2 * 2) / 3) * 2) / 2`.
    2. Nếu chỉ có Task 1 `> 0` (Task 2 = 0 hoặc bài thi chỉ có 1 task): lấy điểm Task 1 làm điểm tính toán (nhãn hiển thị linh hoạt `Task 1 Band` hoặc `T1 Band (Partial)`).
    3. Nếu chỉ có Task 2 `> 0`: lấy điểm Task 2 (nhãn `Task 2 Band` hoặc `T2 Band (Partial)`).
    4. Cho phép giáo viên bấm Publish bài thi đơn task hoặc bài thi đã chấm 1 task mà không bị nút Publish khóa do thiếu task còn lại.
- **Tích hợp tính năng AI Nhận xét & Sửa đoạn chọn trực tiếp (`Inline AI Selection Critique`)**:
  - Bổ sung mode `selection_critique` trong backend `/api/ai_feedback` (`api/index.py`), hỗ trợ giáo viên highlight bất kỳ cụm từ/câu nào để AI tự động phân loại tiêu chí, gợi ý sửa ngắn gọn, viết gợi ý nâng Band 8+, và soạn lời giải thích sư phạm bằng tiếng Việt.
  - Hỗ trợ 2 chế độ: "AI Sửa" (điền vào form để giáo viên duyệt lại) và "AI Lưu ngay" (tự phân tích và thêm ngay vào bài chấm).
  - Viết bộ kiểm thử tự động `tests/test_writing_ai_feedback.py` xác thực tính năng backend.

## Writing Grading (Teacher) & Writing Review (Student) Manuscript Editorial Desk — 2026-10-13

- **Nâng cấp toàn diện không gian chấm/xem Writing (`WritingFeedback.tsx` & `REVIEW_QUIZ.txt`)**: Thay thế giao diện card xếp chồng máy móc bằng bàn làm việc 2 cột chuẩn Manuscript Editorial Desk (`C.bg`, thẻ trắng viền hairline 1px `C.border`, font Fraunces/Inter/Space Grotesk/Space Mono).
- **Thanh điều hướng Task & Đề thi linh hoạt**: Hỗ trợ chuyển đổi nhanh Task 1 (tỷ trọng 1/3) và Task 2 (tỷ trọng 2/3), kèm ngăn kéo đề bài & biểu đồ (`Prompt & Visual Drawer`) có thể đóng/mở mượt mà không làm chật màn hình khi đọc bài.
- **4 Chế độ đọc bài viết học viên**:
  1. `Annotated Original`: Bản gốc kèm số thứ tự đoạn (`¶1`, `¶2` ở lề trái) và highlight màu theo 4 phân loại chuẩn (`error` đỏ san hô, `awkward` hổ phách, `upgrade` chàm indigo, `praise` xanh lục).
  2. `Inline Track Changes (Diff)`: Hiển thị gạch ngang đỏ đoạn cũ và chèn trực tiếp đề xuất sửa mới màu xanh nổi bật trong dòng văn bản.
  3. `Corrected Clean`: Bản sửa hoàn chỉnh toàn bài (hỗ trợ giáo viên soạn thảo/sửa đổi trực tiếp).
  4. `Band 8+ Model`: Bài mẫu tham khảo Band 8.0+ bám sát đề thi.
- **Thanh X-Ray Bar 28px & Radar lặp từ (`Repetition Radar`)**:
  - Đếm số từ trực quan với badge xanh khi đạt chuẩn (`≥150w` Task 1 / `≥250w` Task 2) hoặc badge hổ phách cảnh báo thiếu từ (`Underlength -Nw`).
  - Thống kê số đoạn (`¶`), số câu và mật độ từ trung bình mỗi câu (`w/s`).
  - Radar lặp từ: tự động quét và gạch chân chấm các từ vựng nội dung (độ dài >= 5 ký tự) xuất hiện từ 3 lần trở lên kèm badge số lần lặp.
- **Popover chú thích nổi khi Hover (120ms Hover Bridge)**: Khi rê chuột vào đoạn highlight, popover nổi hiển thị tiêu chí (`TA/TR`, `CC`, `LR`, `GRA`), loại lỗi, đề xuất thay thế (`anchorQuote → replacement`), gợi ý Band 8+ (`highBandRewrite`), giải thích của giáo viên, và nút **`+ Lưu vào Sổ từ vựng`** cho học sinh (đồng bộ trực tiếp vào `vocabNotebook` qua Firestore).
- **Trình soạn chú thích 2 giai đoạn cho giáo viên (`2-Stage Selection Composer`)**:
  - Giai đoạn 1 (Floating Pill): Hiện thanh 3 nút thao tác nhanh (`Lỗi sai`, `Chưa tự nhiên`, `Nâng cấp`) ngay phía trên vùng bôi chọn.
  - Giai đoạn 2 (Composer Popover): Mở trình soạn thảo tinh gọn với chip gắn nhanh thẻ lỗi theo từng tiêu chí, ô nhập thay thế, toggle gợi ý Band 8+, và ô giải thích.
- **Cột thanh tra biên tập 3 Tab (`Inspector`)**:
  - Tab 1 `Rubric & Bottlenecks`: Hộp 3 trọng tâm cần cải thiện (Bottlenecks) đặt ở vị trí ưu tiên; dải chấm điểm dải băng trực quan 4 tiêu chí (`4 đến 9`) kèm mô tả chuẩn IELTS Public Band Descriptors.
  - Tab 2 `Annotations`: Danh sách chú thích dạng sổ cái, lọc theo tiêu chí/loại lỗi, hỗ trợ click/hover để cuộn mượt và nhấp nháy highlight trên bài viết bên trái.
  - Tab 3 `Corrected & Model Essay`: Quản lý nhận xét chung (`generalFeedback`), bản sửa hoàn chỉnh và bài mẫu.
- **AI Co-Pilot chấm nháp 1-Click (`/api/ai_feedback`)**: Nâng cấp backend `/api/ai_feedback` trong `api/index.py` hỗ trợ chấm cấu trúc (chuẩn IELTS 9-band, tính band tự động, sinh 3 bottlenecks, 2-3 điểm mạnh, 6-10 chú thích gắn đúng offset vị trí trong bài, bản sửa hoàn chỉnh và bài mẫu Band 8.5).
- **Xuất Dossier PDF chuẩn học thuật (`Export PDF Dossier`)**: Tạo báo cáo đa mục in ấn chuyên nghiệp (Header IELTS OS, bảng điểm tổng quan, ma trận 4 tiêu chí, kế hoạch hành động, bài viết học sinh với chỉ số chú thích số mũ `[1]`, `[2]`, bảng chi tiết sửa lỗi, bản sửa hoàn chỉnh và bài mẫu).

## Teacher Students Tab Manuscript Standard & Chart Upgrades — 2026-10-13

- **Hệ thống giao diện học viên chuẩn Manuscript/Editorial**: Thay thế hoàn toàn giao diện dạng thẻ lồng (`.card`), nút bấm màu mè (rainbow buttons) và layout trung tâm bằng thiết kế sổ cái (ledger), bề mặt ấm (`C.card`, viền mỏng 1px hairline, góc bo 12px), và dải nhấn 3px (`borderLeft`).
- **Sidebar danh sách học viên tối ưu độ rộng**: Nâng độ rộng cột danh sách bên trái lên `minmax(290px, 320px) minmax(0, 1fr)` với `gap: 24px`. Tách tên học viên sang hàng riêng (Line 1) không bị chèn ép bởi badge học phí, chống tràn/cắt cụt tên dài (VD: "Nguyễn Thị Ngọc Ánh"). Hàng 2 hiển thị Level, Mục tiêu Band và Trạng thái nợ học phí (`Debt: ...`).
- **Nâng cấp biểu đồ Band Trend (`BandTrendChart`) chống tràn chữ & đè nhãn**:
  - Tăng khoảng đệm hai biên `padL = 36, padR = 36` và căn lề trục ngày tháng (`textAnchor="start"` cho ngày đầu, `textAnchor="end"` cho ngày cuối), triệt tiêu hoàn toàn lỗi số/ngày tháng bị tràn mép phải (`31/7/2026`).
  - Lọc bỏ các bài thi điểm 0 hoặc rác (`band < 1.0`).
  - Cơ chế hiển thị nhãn điểm thông minh chống đè chữ: khi số điểm `<= 12` hiển thị toàn bộ; khi `> 12` chỉ hiển thị điểm đầu, điểm cuối, các đỉnh cực trị (min/max peak) và điểm đang hover.
  - Tích hợp thanh chuyển đổi phạm vi (`Recent 15` vs `All (N)`) khi học sinh làm trên 15 bài thi.
  - Bổ sung thanh đọc nhanh điểm số trên đỉnh biểu đồ (Quiz Title · Band · Date) tương tác mượt mà khi hover.
- **Chuẩn hóa nhãn câu hỏi (`formatQuestionTypeLabel`)**: Chuyển đổi toàn bộ enum kỹ thuật thô (`MAP_DRAG`, `FLOWCHART_DRAG`, `SUMMARY_DRAG`, `COLUMN_DRAG`, `DIAGRAM_LABEL`, `NOTES`, `HEADINGS`, `CHOICE`, v.v.) sang tên hiển thị sư phạm rõ ràng (`Map / Plan Drag-and-Drop`, `Flow-chart Drag-and-Drop`, v.v.).
- **Bộ lọc kết quả bài thi theo kỹ năng & tìm kiếm**: Bổ sung bộ lọc kỹ năng (`All`, `Listening`, `Reading`, `Writing`) và ô tìm kiếm tên bài thi vào tab kết quả bài làm của từng học sinh.
- **Dải thao tác học phí & Phần thưởng đồng nhất**: Loại bỏ hoàn toàn các nút gradient/màu sặc sỡ; chuẩn hóa các nút hành động (Nhắc học phí, Thu học phí, Tặng xu, Gacha/Quà tặng) theo nút bấm chuẩn Manuscript viền hairline tinh tế.

## Exam Builder Library Shell & Desktop-Grade File Manager Manuscript Standard — 2026-10-13

- **Hệ thống thư mục chuẩn file manager bền vững**: Thư mục được lưu trữ độc lập trong danh sách `examFolders` (đồng bộ Firestore qua `serverData.examFolders` và sao lưu `localStorage`), cho phép tạo và duy trì thư mục trống thực thụ mà không cần tạo quiz nháp rác `"Bản nháp (Xóa nếu không dùng)"`.
- **Thao tác thư mục đầy đủ & An toàn**: Hỗ trợ Tạo thư mục mới (`handleCreateFolder`), Đổi tên (`handleRenameFolder`), Di chuyển thư mục (`handleMoveOrRenameFolder` với cơ chế chặn di chuyển vào chính nó hoặc thư mục con), và Xóa thư mục (`handleDeleteFolder` với cơ chế an toàn: tự động chuyển toàn bộ đề thi con về thư mục cha thay vì làm mất dữ liệu).
- **Tương tác Kéo thả (Drag-and-Drop)**: Cả đề thi và thẻ thư mục đều hỗ trợ kéo thả (`onDragStart`, `onDragOver`, `onDrop` với highlight vùng nhận diện `dragOverFolderTarget`). Người dùng có thể kéo thả đề thi trực tiếp vào thẻ thư mục con hoặc thả vào bất kỳ mắt xích nào trên thanh Breadcrumb (`Root/...`).
- **Modal quản lý thư mục tương tác (`folderModal`)**: Thay thế toàn bộ `window.prompt()` trình duyệt bằng modal chuẩn Manuscript với cây thư mục dạng lồng cấp (`allKnownFolders`), hỗ trợ tìm vị trí đích bằng 1 cú click cho cả thao tác di chuyển thư mục và di chuyển hàng loạt đề thi (`MOVE_QUIZZES`).
- **Thanh lệnh thao tác hàng loạt (Bulk Command Bar)**: Tái thiết kế theo chuẩn Manuscript/Editorial tinh gọn với viền hairline mỏng, không màu cầu vồng, hiển thị số lượng đề đã chọn, nút Deselect/Select folder, các cụm nút chức năng theo nhóm (Chế độ thi: Exam/Practice, Xuất bản: Publish/Unpublish/Publish ready, Tổ chức: Move to.../Lock/Unlock/Real package, Xóa hàng loạt an toàn).
- **Danh sách đề thi**: Card đề thi hiển thị dạng hàng đơn tinh gọn, font Fraunces cho tiêu đề, icon kỹ năng 36×36px, huy hiệu trạng thái Mode/Publish/Lock, và bộ nút hành động đồng nhất (Preview, Key, Duplicate, Download Key, Re-grade, Edit exam).
- **Bộ lọc & Sắp xếp**: Tích hợp trực tiếp trên thanh breadcrumb: lọc theo kỹ năng (`All`, `Listening`, `Reading`, `Writing`, `Integrated`), sắp xếp theo tiêu đề (`A-Z`), thời gian tạo (`Newest`), số câu hỏi (`Questions`), và ô tìm kiếm real-time.
- **Batch AI DOCX**: Khối thông tin batch AI DOCX hỗ trợ thu gọn/mở rộng (`aiBatchCollapsed`) và nút bỏ qua ("Dismiss") khi batch không còn tác vụ đang chạy.
- **Hạ tầng build Windows cp1252**: `compile_app.py` được bổ sung cấu hình tự động reconfigure `sys.stdout` và `sys.stderr` sang `utf-8` khi build bằng `npm run build` trên Windows, tránh lỗi UnicodeEncodeError khi in icon/ký tự đặc biệt.

## Boot and Sync Screen Manuscript Standard — 2026-10-13

- Standalone `.booting-screen`, `.booting-card`, `.booting-bar`, `.booting-bar-fill`, and `@keyframes bootSlide` added directly to `src/index.css` so pre-login (`authChecking`) and pre-sync (`!loaded`) screens never render unstyled or pinned to top-left before React memos evaluate.
- Early returns in `src/App.template.tsx` now use `renderBootScreen('auth' | 'sync')` including `{globalStyles}`, `<BrandLogo size={38} />`, `<BrandWordmark size={20} />`, an editorial `"Academic Workspace"` label, a 2px hairline indeterminate progress bar (`bootSlide`), and localized step typography (`01 / 02 · VERIFYING SESSION` / `02 / 02 · SYNCING WORKSPACE`). Obsolete circular spinners and legacy emojis removed.
- `#root` normalized in `src/index.css` to `width: 100%; max-width: 100%; margin: 0; text-align: left; border: none; min-height: 100svh; display: flex; flex-direction: column; box-sizing: border-box;`.

## Teacher Dashboard and Navbar Manuscript standard — 2026-10-13

- `#root` styling in `src/index.css` no longer forces `text-align: center;` or fixed `width: 1126px; border-inline`, preventing global center-alignment bleed into teacher/admin dashboards and exam views.
- Top navbar `.ios-tabs-container` cleanly hides scrollbars (`scrollbar-width: none`, `::-webkit-scrollbar { display: none }`) and `.tab-btn` is tightened to `padding: 6px 12px; font-size: 13px; border-radius: 8px`, accommodating all 8 teacher tabs on standard laptop viewports.
- Removed duplicate floating language toggle in the Teacher Portal bottom-left (already provided by `<LanguageToggle role="TEACHER" />` in the top navbar).
- Restyled bottom-right scroll-to-top button to 38×38 Manuscript card aesthetic.
- Standardized Teacher Dashboard ledger card and schedule item rows to left-aligned editorial layout with 3px left accent borders (`borderLeft`), `var(--mono)` time badges, safe link pills for HTTP URLs, compact link chips for materials, and standardized action button groups.
- Flattened the right-hand column calendar and announcement into a seamless unified panel container without card-in-card nesting, replacing raw `<` / `>` text with SVG chevrons and adding a subtle clear button for active announcements.

## Test-room SVG media rendering — 2026-09-16

- `formatContent()` must validate remote image URLs by parsing `new URL(url).pathname`, not by matching the whole URL or using `url.endsWith(...)`. Firebase Storage SVG downloads keep `.svg` in the pathname but add `?alt=media&token=...`; query-blind raster-only regexes make the test room fail to render them.
- Keep remote SVG rendering on ordinary `<img src={url}>` paths with `max-width:100%`, `height:auto` and `object-fit:contain`. Do not fetch SVG text or inject it into the DOM.

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
- The raw-DOCX provider outer timeout must not be shorter than the backend provider's own 55-second request/fallback window. The pipeline now bounds generation to two 90-second attempts. Provider JSON decoding is deliberately inside that same retry envelope, so malformed transient model JSON retries before any canonical object exists. If it still times out or remains malformed, mark the row `FAILED / GENERATION* / NOT_RUN`, preserve its source, and expose the retry route; never report a non-existent DOCX as a parser-contract failure.
- Keep the raw-DOCX first pass structural only (`correct_answers=[]`, no explanations). Answers and grounded explanations belong to the bounded per-question Solver stage; asking the first pass to emit both duplicates work and can truncate a large canonical JSON response before its strict schema gate.
- The raw durable worker must explicitly clamp `question_workers` to at least one. `PipelineConfig(question_workers=0)` is reserved for fixtures that already contain answers; applying it to structure-only production input creates an unanswerable exam and must fail closed.
- A terminal malformed canonical JSON failure retains its final raw model response only in the private Storage result payload (`provider_response_debug`) so it can be diagnosed without exposing it in a Firestore row or the browser UI. Keep this debug artifact private and bounded to 60,000 characters.
- Raw-DOCX provider routing must receive a monotonic inner deadline below the outer retry watchdog. The generic chat router keeps legacy behavior for ordinary routes; only `ExistingBackendProvider` uses short bounded attempts and family rotation. Never rely on cancelling a Python worker thread to stop an active `urlopen`.
- The raw-DOCX Solver defaults to two concurrent question workers to avoid free-provider burst limits. Each Solver/repair response must contain a non-empty answer list plus `explanation.why` and an exact `explanation.evidence.quote`; malformed valid JSON is kept only in the private `question_response_debug` artifact, never on a Firestore row or UI.
- The browser sends `/advance` only when a durable row is `QUEUED`; it polls processing rows without repeatedly claiming them. Cross-tab Firestore contention is normal and must return a fresh batch snapshot, not HTTP 503. Explicit retries may requeue provider, incomplete Solver/repair, and worker failures with a fresh job ID; previous private diagnostic pointers remain in retry history. Parser/quality failures remain protected.
- Renew active worker leases independently of AI progress callbacks, and fence artifact/catalog/terminal writes behind a successful ownership check. Stop the timer before terminal completion. A blocked AI call must not silently expire a healthy worker's lease.
- Source/media preflight may transition directly from `QUEUED` to `MANUAL_REVIEW`. Blocking unsupported input must preserve the actual diagnosis, never raise an illegal-transition `WORKER_FAILURE` instead.
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

## Managed audio upload and transcription — 2026-09-13

- Listening audio must upload browser-to-Storage through `POST /api/exam-audio/uploads` → signed `PUT` → `POST /api/exam-audio/uploads/{uploadId}/complete`. Do not proxy the source file through Vercel: its request body limit makes large audio unreliable. Both ticket endpoints require a Firebase-verified exam manager; the ticket owns one exact object path and expires within 30 minutes.
- The completion endpoint is the trust boundary: it verifies the signed object's owner ticket, size, canonical MIME, filename and audio header before issuing the stable `/api/audio/...` proxy URL. Server-side transcription must not HTTP-fetch that first-party route. Resolve it with the same audio-key decoder, validate the `exam-audio/` Storage path/token, and download bytes directly with Firebase Admin. Genuine small public external audio URLs may still use the bounded HTTP path, but invalid `/api/audio/...` tokens must fail as internal resolve errors instead of falling through to external fetch.
- A browser signed `PUT` needs a real bucket CORS rule. The initializer checks/merges only configured trusted origins and fails before upload if it cannot do so. `FIREBASE_SERVICE_ACCOUNT_JSON` therefore needs Storage bucket metadata/CORS update permission as well as object permissions. Add every preview origin deliberately in `AUDIO_UPLOAD_CORS_ORIGINS`; do not open CORS to `*`.
- Whisper requests remain below 23 MiB. Large managed recordings are transcoded via the bundled `imageio-ffmpeg` binary to ordered 16 kHz mono 32 kbps chunks, then real Whisper timestamps are offset to source time. Keep the production envelope at no more than five 9-minute chunks / 45 minutes / two workers: Vercel allows 300 seconds, so a larger job must fail closed with a split instruction rather than become a worker timeout. The Gemini File API is private, bounded fallback only when the local transcoder cannot run.
- Service worker and the audio proxy must keep bypassing media and `Range` caching. A managed audio URL is intentionally same-origin and range-preserving for native Listening playback; never replace it with a redirect that loses the `Range` header.
