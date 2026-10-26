# IELTS OS — Session Handoff (cập nhật 2026-10-26)

## Cải Tiến Trải Nghiệm Xem Lại Bài Matching Headings & Tinh Chỉnh Bảng Từ Đồng Nghĩa AI (`REVIEW_QUIZ.txt`, `api/index.py`, `App.template.tsx`) — 2026-10-26

- **Chuyển Toàn Bộ Khối Review Matching Headings (`DRAG_DROP_HEADING`) Sang Cột Trái Bài Đọc**:
  - Bóc tách mã `[HEADING_SLOT]` kiên cố bằng regex đa thẻ (`(?:<(?:div|p)[^>]*>\s*)?(?:<(?:span|strong|b|em|i)[^>]*>\s*)*\[HEADING_SLOT\]...`), triệt tiêu 100% hiện tượng rò rỉ mã `[HEADING_SLOT]` ra văn bản bài đọc.
  - Hiển thị thanh Heading Bar tương tác trực tiếp phía trên mỗi đoạn văn (Paragraph A, B, C...):
    - Huy hiệu số thứ tự câu hỏi (`rv-qnum-badge`), nhãn tên đoạn (`Paragraph A`).
    - Trạng thái trả lời rõ ràng: gạch ngang đỏ nếu chọn sai (hoặc màu cam nếu bỏ trống), mũi tên trỏ tới đáp án đúng màu xanh lá.
    - Hàm chuẩn hóa `formatCleanHeadingLabel` loại bỏ triệt để tiền tố lặp thừa (`ii. B. The department...` -> `ii. The department...`).
    - Cụm micro-button thao tác nhanh đặt thẳng hàng: `[💡 Giáo viên]`, `[📍 Định vị]` và `[💡 AI]` (kèm đầy đủ icon bóng đèn SVG và chữ in đậm, không bị rớt dòng).
- **Đơn Giản Hóa Cột Phải Bài Thi Cho Dạng Nối Tiêu Đề**:
  - Loại bỏ hoàn toàn các thẻ card câu hỏi nối tiêu đề riêng lẻ gây choán chỗ ở cột phải.
  - Tinh gọn thành 1 thẻ duy nhất: **"List of Headings"** (danh mục tiêu đề) với các phương án đúng được tô nền xanh lá và gắn nhãn `✓ Đúng`. Kèm 1 dòng chỉ dẫn trực quan hướng dẫn học viên bấm nút giải thích trực tiếp tại từng đoạn bên cột bài đọc.
- **Cửa Sổ Giải Thích Nổi Tự Động Định Vị Thông Minh (Smart Auto-Flip Popover)**:
  - Thay thế việc chèn inline accordion làm xô lệch dòng bài đọc bằng popover nổi thông minh (`#rv-heading-popover`).
  - Tự động đo khoảng trống khả dụng (trên/dưới), auto-flip lật lên trên hoặc xuống dưới thanh heading bar để không bị che khuất. Kẹp biên ngang an toàn trong cột bài đọc.
  - Tự động đóng khi nhấn phím `Escape`, nhấp chuột ra ngoài (click outside) hoặc khi cuộn trang vượt quá tầm nhìn.
- **Bảo Vệ Văn Bản Bài Đọc Khỏi Ô Nhiễm Highlight ("Highlight Pollution")**:
  - Chặn đứng hàm `rvLocateQuestionEvidence` đối với `DRAG_DROP_HEADING`, ngăn việc lấy toàn bộ câu tiêu đề heading đem đi highlight tràn lan trong văn bản đoạn văn.
  - Bổ sung hàm riêng biệt `rvLocateHeadingEvidence`: chỉ highlight khi có câu trích dẫn chứng minh cụ thể từ AI hoặc Giáo viên; nếu không có, tự động cuộn mượt và nháy viền nhẹ (`rv-flash-ring`) tại thanh tiêu đề đoạn tương ứng.
- **Chuẩn Hóa Option B Cho Bảng Đối Chiếu Từ Đồng Nghĩa (Synonym/Paraphrase Table)**:
  - Dạng bài Matching Headings và Main Idea kiểm tra ý chính toàn đoạn văn chứ không kiểm tra từ vựng đơn lẻ -> Lược bỏ hoàn toàn `"1. ĐỐI CHIẾU TỪ ĐỒNG NGHĨA"` (cả phía backend Prompt lẫn frontend Render). Khối dẫn chứng được đổi thành `"Ý CHÍNH CỦA ĐOẠN & DẪN CHỨNG CỐT LÕI"`.
  - Đối với các câu hỏi chi tiết:
    - **Rule A (True Source Membership)**: Bắt buộc từ khóa câu hỏi phải thực sự xuất hiện trong đề bài/phương án, từ khóa dẫn chứng phải thực sự nằm trong bài đọc. Tự động đảo vị trí nếu AI trả ngược cột (`auto-swap`).
    - **Rule B (No Echoes)**: Loại trừ các cặp từ giống nhau hoặc trùng lặp >= 70% số từ (ví dụ `education` ⇄ `education`).
    - **Rule C (Graceful Auto-Hide)**: Nếu 0 cặp từ nào vượt qua kiểm duyệt, tự động ẩn Khối 1 và hiển thị khối dẫn chứng bắt đầu sạch sẽ bằng `"DẪN CHỨNG CHÍNH XÁC VÀ GIẢI THÍCH CHI TIẾT"`, không bao giờ hiển thị nhãn số `"2."` bơ vơ.

## Tối Ưu Tốc Độ `/api/ai_explain` Xuống 1.0 – 2.2s & Caching Tức Thì < 50ms (Sub-2s Cold / <50ms Cached AI Explanations) — 2026-10-26

- **Triệt tiêu nhân đôi bài đọc & Siết gọn cửa sổ Transcript bài nghe**:
  - Trong `src/App.template.tsx` (`handleAiExplain`), trước đây `qPassage` bị đưa vào cả `context` lẫn `readingPassage`, làm phình to payload thêm hơn 15.000 ký tự không cần thiết. Đã tách bạch triệt để: đối với Reading, `context` chỉ chứa `groupContext` (bảng tóm tắt, biểu đồ, ghi chú câu hỏi), bài đọc chỉ gửi duy nhất 1 lần qua `readingPassage: stripTags(qPassage).slice(0, 9000)`.
  - Cửa sổ transcript bài nghe (`transcriptForQuestion`) được thu hẹp từ 23.000 ký tự xuống còn tối đa 6.500 ký tự tập trung quanh câu hỏi hiện tại, tự động bắt dính vào mốc thời gian `(` hoặc đầu dòng `\n` gần nhất.
  - Phía backend `api/index.py`: xây dựng khối `source_block` tinh gọn, loại bỏ hoàn toàn việc in lặp lại context và reading passage trong `user_prompt`.
- **Tái sử dụng kết nối HTTP Keep-Alive & Bẻ gãy vòng lặp Waterfall Fallback**:
  - Khởi tạo `requests.Session` với `HTTPAdapter(pool_connections=25, pool_maxsize=50)` dùng chung cho toàn bộ các lượt gọi OpenAI-compatible (Groq/Cerebras) và Google Gemini, loại bỏ 100-250ms độ trễ bắt tay TCP/TLS trên mỗi request.
  - Xử lý mã lỗi HTTP chuẩn xác và chuyển nhánh tức thì: ánh xạ lỗi HTTP 413 và 429 thành `RATE_LIMIT` (giúp thoát sớm khỏi key đã hết hạn mức thay vì tiếp tục thử tuần tự qua nhiều model); ánh xạ HTTP 400 và 404 thành `BAD_MODEL` (loại bỏ ngay lập tức model hỏng khỏi hàng đợi của mọi key trong router).
  - Giảm thời gian chờ mặc định `request_timeout` từ 55s xuống 12.0s; dọn sạch các model đã bị nhà cung cấp khai tử (`gemini-2.0-flash`, `gemini-2.5-flash`).
- **Prompt sư phạm tối giản & Giảm Token Output**:
  - Giảm `max_tokens` của lượt gọi LLM từ 500 xuống 380 tokens, `temperature=0.2`.
  - Quy tắc phân tích tinh gọn: chỉ tập trung (1) chứng minh vì sao đáp án đúng là chính xác và (2) phân tích căn nguyên vì sao lựa chọn của học sinh bị sai (hoặc chiến thuật nếu bỏ trống). Không phân tích lan man các lựa chọn mà học sinh không chọn.
- **Bộ nhớ đệm 2 tầng phía Client & In-Memory LRU Cache Server**:
  - Phía Backend: Khởi tạo bộ đệm in-memory `_AI_EXPLAIN_CACHE` đồng bộ luồng qua `threading.Lock()` (khóa SHA-256 từ `(lang, question, options, correct, student_ans, context[:1000], reading_passage[:1000], matching_target_label)`, tối đa 500 mục LRU). Các lượt gọi cùng câu hỏi phản hồi trong `< 5ms`.
  - Phía Client: Khởi tạo `aiExplainCacheRef` trong React ref kết hợp `sessionStorage` (khóa `${quizId}_${q.id}_${stuStr}_${langKey}`). Khi học viên click lại câu hỏi đã giải thích, giao diện hiển thị ngay lập tức trong `< 1ms` mà không tạo hiệu ứng chớp tắt loading.

## Khắc Phục 5 Vấn Đề Production Then Chốt (5 Critical Production Hardening Fixes) — 2026-10-26

### 1. Tối Ưu Tốc Độ `/api/ai_explain` Sau Khi Nâng Cấp Gemini 3.8 Flash (`api/index.py`)
- **Vô hiệu hóa Thinking Budget triệt để cho dòng Flash**: Cập nhật `_gemini_chat_once` và `_vertex_gemini_generate` để tự động set `thinkingConfig: {"thinkingBudget": 0}` cho tất cả các mô hình chứa `2.5`, `3.`, hoặc `flash`. Thêm cơ chế tự động thử lại 1 lần không kèm `thinkingConfig` nếu API trả mã HTTP 400.
- **Triệt tiêu lệnh gọi LLM đồng bộ lần 2**: Loại bỏ hoàn toàn lượt gọi LLM thứ 2 khi xác minh dẫn chứng reading. Thay bằng thuật toán tìm kiếm mờ (fuzzy substring 6+ từ) và bộ xếp hạng câu Python thuần (`_score_evidence`) phản hồi tức thì trong `< 1ms`.
- **Siết gọn Context & Token Budget**: Giới hạn trần `context` và `readingPassage` từ 24.000 xuống 12.000 ký tự; hạ `max_tokens` từ 1.000 xuống 500 (`timeout_s=25.0`). Bổ sung quy tắc sư phạm trọng tâm cho câu hỏi trắc nghiệm/nối: chỉ phân tích vì sao đáp án đúng là chính xác và vì sao lựa chọn của học viên bị sai, không phân tích lan man các lựa chọn học viên không chọn.

### 2. Triệt Tiêu Đơ Giật UI & Tràn Bộ Nhớ Trong Exam Builder (`src/App.template.tsx`, `EXAM_BUILDER.txt`)
- **Tối ưu `RichTextEditor`**: Bọc component bằng `React.memo` và debounce sự kiện `onInput` 250ms qua `debounceTimerRef`, đồng thời flush cập nhật ngay lập tức khi `onBlur` hoặc kích hoạt các nút định dạng toolbar.
- **Bảo vệ lưu nháp an toàn `ielts_exam_draft`**: Bọc `localStorage.setItem` trong khối `try/catch`. Nếu gặp `QuotaExceededError`, tự động lược bỏ các chuỗi dữ liệu ảnh Base64 kích thước lớn trước khi lưu nháp, tránh làm sập ứng dụng. Tăng thời gian chờ debounce từ 2s lên 4s.
- **Tránh re-render toàn bộ cây component khi bấm Lưu**: Trong `handleForceSave`, chỉ cập nhật các trường metadata (`revision`, `updatedAt`) vào state `editingQuiz`, giữ nguyên con trỏ và vùng chọn của người dùng trong editor.
- **Chuyển dịch 100% sang Delta Upsert**: Thay thế các lệnh ghi đè danh mục `syncData({ quizzes: nx })` bằng `persistBulkQuizUpdates` và `syncData({ __quizUpserts: [...] })` (khi lưu Key đáp án hoặc tạo bản sao đề).

### 3. Sửa Lỗi Thanh Tiến Trình Audio Đứng Yên Ở Chế Độ Luyện Tập (`src/components_split/ACTIVE_EXAM.txt`, `src/App.template.tsx`)
- **Chuẩn hóa điều kiện kiểm tra Practice Mode**: Đồng bộ thống nhất trên toàn codebase: `isPracticeListeningMode = isPracticeQuiz(activeExam) || (activeExam as any)?.audioMode === "practice"`.
- **Đồng bộ liên tục thời lượng `audioDur`**: Trong `publishAudioProgress` và `handleExamAudioPlaying`, tự động cập nhật `audioDur` từ `audioRef.current.duration` ngay khi có dữ liệu. Cho phép tua tiến/lùi qua MediaSession.
- **Khắc phục kẹp giá trị 0 trên thanh trượt**: Khi `audioDur` chưa sẵn sàng, tính toán `liveDur` và `effectiveMax` an toàn để không kẹp `safeCur` về 0, đảm bảo thanh trượt tua và nhãn thời gian phản hồi liên tục khi audio phát.

### 4. Chống Hồi Sinh Gói Đề Thi Thật Đã Xóa & Xử Lý Hàng Đợi Đột Biến (`src/App.template.tsx`)
- **Bộ ghi nhớ Tombstone phía Client & Firestore**: Lưu trữ danh sách ID gói đề thi thật đã xóa vào `localStorage` (`ielts_deleted_real_exam_packages`). Khi xóa gói đề, phát sinh tombstone và đồng bộ marker `__realExamPackageDeletedIds`.
- **Hợp nhất Transactional trong `performSyncData`**: Merge mảng `realExamPackageTombstones` trên Firestore và loại trừ triệt để các package đã xóa khi hợp nhất danh sách.
- **Bộ lọc phòng vệ tại `applyWorkspaceSnapshot`**: Lọc bỏ các gói thi nằm trong tombstone trước khi nạp vào React state, ngăn chặn tình trạng gói đề cũ bị hồi sinh từ các snapshot trễ.
- **Circuit Breaker trong `flushPendingWorkspaceMutations`**: Tự động phát hiện và loại bỏ các mutation "độc" (bị lỗi retry >= 5 lần hoặc chứa mảng `quizzes` cồng kềnh lỗi thời), giải tỏa tắc nghẽn hàng đợi đồng bộ ngoại tuyến.

### 5. Loại Bỏ Triệt Để Cơ Chế Khóa/Mở Khóa Đề Cũ (`isLocked`)
- **Gỡ bỏ `isLocked` khỏi dữ liệu**: Xóa thuộc tính `isLocked` khỏi interface `Quiz`, các hàm khởi tạo đề thi và hàm nhân bản `duplicateQuiz`.
- **Dọn dẹp giao diện Exam Builder**: Xóa bỏ các nút bấm Khóa/Mở khóa hàng loạt, xóa icon ổ khóa trên tiêu đề thẻ đề thi và nhãn trạng thái khóa.
- **Đơn giản hóa quyền truy cập ở Student Portal**: Gỡ bỏ kiểm tra `q.isLocked` trong logic hiển thị trạng thái đề thi của học viên.
- **Bảo toàn phòng thủ chống gian lận**: Giữ nguyên vẹn 100% cơ chế khóa cứng phiên làm bài khi phát hiện thi đồng thời trên thiết bị khác (`isLockedByOtherDevice`).

## Tinh Gọn Khối Nhận Diện Điểm Yếu & Chuyển Sang Tab Tiến Độ Học (Weakness Analysis Bento & Sub-Tab Architecture) — 2026-10-26

- **Đặt tên giản dị, xóa bỏ thuật ngữ AI khoa trương**:
  - Tiêu đề cũ *"Error DNA & Weakness Diagnostic Engine / Chẩn đoán DNA Lỗi sai & Lỗ hổng Tư duy"* được chuẩn hóa thành **"Nhận diện điểm yếu & Bẫy đề"** (`Weakness & Trap Analysis`).
  - Phụ đề sư phạm gần gũi: *"Thống kê từ lịch sử làm bài để chỉ ra dạng bài và bẫy đề bạn hay mất điểm nhất."*.
- **Tái thiết kế Bento Grid 2 Cột Đối Xứng (Anti-Scroll & Clean Information Architecture)**:
  - Thay thế 3 hộp căn nguyên lỗi dàn ngang cồng kềnh bằng 1 thanh **Segmented Bar 3 màu trực quan** (Indigo `#4338ca` Lỗ hổng từ vựng | Amber `#d97706` Bẫy đề/Nhiễu | Rose `#e11d48` Đọc sai phạm vi) kèm 3 dòng số liệu tinh gọn.
  - Sắp xếp tự động các dạng bài theo thứ tự ưu tiên cần cải thiện gấp (dạng có tỷ lệ chính xác % thấp nhất lên đầu tiên), thanh mini bar 4px tinh tế.
  - Kế hoạch hành động 7 ngày (`AI Action Plan`) chuyển thành khối collapsible accordion `[ + Xem lộ trình cải thiện 7 ngày từ AI ]`, học viên cần xem mới bấm mở ra.
- **Kiến trúc Sub-tab Tinh Gọn Trong Tab Tiến Độ (Progress Sub-tabs)**:
  - Chuyển hoàn toàn khối phân tích này ra khỏi Dashboard (giúp Dashboard quay về đúng vai trò Overview gọn gàng).
  - Tích hợp 2 Sub-tab dạng Pill Switcher ngay đầu trang Tiến độ:
    - **Năng lực & Điểm yếu** (`Performance & Weaknesses`): Biểu đồ Band điểm (`BandTrendChart`) đặt ngay trên, Bảng Nhận diện điểm yếu & Bẫy đề đặt ngay dưới -> xem trọn vẹn trong 1 màn hình không cần cuộn trang.
    - **Tài liệu & Lịch sử lớp** (`Resources & History`): Chứa Drive tài liệu chia sẻ và Lịch sử buổi học lớp, tách biệt hoàn toàn để trang không bị kéo dài vô tận.

## Khắc Phục Lỗi Tràn Viền Thanh Điều Hướng & Biến Mất Nút Đăng Xuất Khi Đổi Ngôn Ngữ (Student Portal Responsive Navbar) — 2026-10-26

- **Nguyên nhân gốc rễ (Root Cause)**:
  - Khi chuyển từ tiếng Việt sang tiếng Anh (`VI ⇄ EN`), các nhãn của 6 tab điều hướng (`Overview`, `Test Room`, `Quests`, `Vocabulary`, `Progress`, `Rewards`), cụm trạng thái đồng bộ (`TIME SYNCED`), nút đăng xuất (`Logout`) và đặc biệt là chuỗi thời gian đăng nhập (`Last login: hh:mm:ss dd/mm/yyyy`, chiếm tới ~230px) có độ dài ký tự lớn hơn đáng kể so với tiếng Việt.
  - Trên màn hình laptop tiêu chuẩn (1366×768) hoặc màn hình Full HD với tỉ lệ thu phóng hệ thống Windows 125%/150% (độ rộng viewport khả dụng chỉ từ 1280px đến 1366px), tổng chiều rộng của các phần tử (`Left Brand: ~210px` + `6 Tabs: ~570px` + `Right Cluster: ~550px` + `Navbar Padding & Gaps: ~120px` = ~1450px) đã vượt quá 100vw.
  - Do thanh `<nav>` sử dụng `justifyContent: 'space-between'` với `flexShrink: 0` trên cụm tác vụ bên phải trong khi container cha `.student-portal` có `overflowX: 'hidden'`, các phần tử ở mép ngoài cùng bên phải (cụ thể là nút Đăng xuất) đã bị đẩy ra ngoài khung nhìn và bị xén cụt.
- **Giải pháp xử lý triệt để & Luật bất biến (Core Fix & Rules)**:
  - **Khai báo hộp kích thước chuẩn**: Đặt `boxSizing: 'border-box'`, `width: '100%'`, `maxWidth: '100vw'` cho `<nav className="st-nav-root">`.
  - **Bọc thanh Tab Desktop co giãn linh hoạt**: Đặt `flex: '1 1 auto'`, `minWidth: 0`, `display: 'flex'`, `justifyContent: 'center'`, `overflowX: 'auto'`, `scrollbarWidth: 'none'` cho `.st-nav-tabs-wrapper`. Kẹp biên co giãn kích thước nút tab `padding: '6px clamp(7px, 0.85vw, 13px)'`, `fontSize: 'clamp(11.5px, 0.85vw, 13px)'` để thanh tab co giãn mềm mại mà không bao giờ chèn ép các khối khác.
  - **Neo vững chắc cụm hành động bên phải (`flexShrink: 0`, `marginLeft: 'auto'`)**: Đảm bảo cụm nút chuyển đổi ngôn ngữ, bật/tắt chế độ tương phản và nút Đăng xuất luôn được neo chắc chắn ở góc phải viewport và không bao giờ bị đẩy rớt ra ngoài.
  - **Triệt tiêu hoàn toàn nguy cơ tràn viền ở mọi tỷ lệ màn hình (Scale 125%/150%)**:
  - Khi người dùng sử dụng Windows scaling 125% (độ phân giải 1920x1080 -> viewport 1536px), chuỗi `Đăng nhập gần nhất: hh:mm:ss dd/mm/yyyy` (~260px) và nhãn chữ `ĐÃ ĐỒNG BỘ GIỜ` (~135px) đã đẩy tổng bề rộng navbar lên ~1546px (> 1536px), gây xén cụt chữ "xuất" ở nút Đăng xuất.
  - **Loại bỏ vĩnh viễn chuỗi `lastLoginTime` khỏi thanh Navbar**: Chuyển trọn vẹn thông tin này về Student Masthead (`· Đăng nhập gần nhất: ...`) ngay dưới lời chào của học viên, giải phóng ngay lập tức 260px.
  - **Thu gọn trạng thái đồng bộ thành Beacon tín hiệu 28px**: Thay thế nhãn chữ cồng kềnh bằng chấm tròn tín hiệu phát sáng xanh/vàng nhỏ gọn có tooltip giải thích đầy đủ khi rê chuột.
  - **Biên độ an toàn tuyệt đối**: Tổng chiều rộng navbar tối đa sau khi tối ưu chỉ còn ~980px, tạo khoảng trống dự phòng an toàn lên tới 550px+ trên màn hình 1536px và hơn 300px trên màn hình 1280px, miễn nhiễm 100% với lỗi tràn viền ở cả tiếng Việt lẫn tiếng Anh.

## Tái Thiết Kế Ngăn Giải Thích AI 3 Khối Sư Phạm & Giao Diện Review (3-Block Structured AI Explanation) — 2026-10-25

- **Loại bỏ triệt để vấn đề rườm rà và ô nhiễm highlight ("Highlight Pollution")**:
  - Gỡ bỏ hoàn toàn nền vàng nâu xỉn cũ (`#FFFBEB` / `#FDE68A` / `#854D0E`), thay bằng thẻ card trắng hiện đại, viền sắc nét `#E2E8F0` và đường viền nhấn xanh cobalt học thuật `#2563EB`.
  - Triệt tiêu hoàn toàn tình trạng bôi vàng cả đoạn trích dẫn (`rgba(254, 240, 138, 0.5)`); dẫn chứng trích dẫn được làm nổi bật tinh tế bằng nền xanh nhạt `#EFF6FF` với đường viền mờ `#DBEAFE` và nhãn bấm định vị trực tiếp trong bài đọc / transcript (`nhấn để định vị trong bài`).
  - Cắt bỏ 100% câu dẫn meta sáo rỗng ("Câu hỏi yêu cầu thí sinh...", "The question tests ability to...") và triệt tiêu lỗi lặp lại 3 lần câu trích dẫn trong cùng một lời giải thích.
- **Cấu trúc 3 Khối Sư Phạm Chuẩn Mực & Chuẩn Hóa 100% SVG (`rvRenderDetailedAiExplanation`)**:
  - Gỡ bỏ hoàn toàn các emoji thô (`💡`, `🔄`, `⚠️`, `✓`), thay bằng bộ icon SVG chuẩn mực (Feather/Lucide style): icon bóng đèn học thuật xanh cobalt cho tiêu đề, icon xoay mượt mà cho nút "Phân tích lại", icon tam giác cảnh báo cho bẫy lỗi sai, icon la bàn chiến thuật cho câu bỏ trống và icon tích tròn cho câu làm đúng.
  - **Khối 1: ĐỐI CHIẾU TỪ ĐỒNG NGHĨA (Paraphrase Matching)**: Hiển thị trực quan từng cặp từ khóa đề bài ⇄ bài đọc/lời thoại dưới dạng chip tinh gọn (`Đề bài: "Similar results" ⇄ Bài đọc: "did not vary"`), hỗ trợ chú thích ngữ nghĩa.
  - **Khối 2: DẪN CHỨNG CHÍNH XÁC VÀ GIẢI THÍCH CHI TIẾT (Evidence & Detailed Explanation)**: Ghi rõ vị trí dẫn chứng (`- Đoạn E, dòng 7: "..."`), hỗ trợ click để cuộn định vị ngay lập tức, kèm dòng `- Giải thích chi tiết:` phân tích trực tiếp lý do logic vì sao dẫn chứng chứng minh đáp án đúng.
  - **Khối 3: PHÂN TÍCH THÍCH ỨNG THEO KẾT QUẢ THÍ SINH (Adaptive Trap Analysis)**:
    - *Nếu làm sai*: Thẻ cảnh báo đỏ nhạt `3. PHÂN TÍCH NGUYÊN DO CHỌN SAI` (`Bẫy phạm vi / Bẫy từ khóa: ...`).
    - *Nếu bỏ trống*: Thẻ chiến thuật xanh lá `3. NGUYÊN DO BỎ TRỐNG & CHIẾN THUẬT BẮT NHỊP` (`Chiến thuật bắt nhịp từ khóa: ...`).
    - *Nếu làm đúng*: Thẻ ghi chú `3. LƯU Ý BẪY TIỀM ẨN CẦN TRÁNH` (`Lưu ý bẫy tiềm ẩn: ...`).
- **Tối ưu Backend Endpoint `/api/ai_explain` & Cập Nhật Mô Hình Gemini 3.8 Flash**:
  - Khắc phục lỗi Google deprecate `gemini-2.5-flash` và `gemini-2.0-flash` (gây lỗi 404): nâng cấp pool mô hình sang `gemini-3.8-flash` và `gemini-3-flash-preview` tốc độ cao, khả dụng tức thì.
  - Gom 2 lần gọi AI tuần tự trước đây thành 1 lần gọi duy nhất với schema JSON có cấu trúc (`paraphrasePairs`, `evidence`: `{location, quote}`, `detailedExplanation`, `trapAnalysis`: `{trapTitle, trapReason}`), giảm 50% độ trễ (từ ~8s xuống ~3s).
  - Tự động kiểm chứng dẫn chứng nguyên văn với bài đọc (`evidence_passage`) và liên kết mốc thời gian bài nghe (`audio_evidence_segments`).
  - Đồng bộ hoá toàn bộ payload trả về: cung cấp cả `structured`, `explanation` (markdown tương thích ngược) và `deconstruction` để bảo toàn khả năng tương thích 100%.
  - Hỗ trợ đầy đủ song ngữ (100% tiếng Việt khi `lang == 'vi'`, 100% tiếng Anh khi `lang == 'en'`).

## Tái Thiết Kế Màn Hình Đăng Nhập "Live Exam Workbench" (Chuẩn EdTech Thực Chiến) — 2026-10-25

- **Loại bỏ triệt để phong cách vàng đen đa cấp và bố cục rập khuôn ("mùi AI")**:
  - Gỡ bỏ hoàn toàn các card icon bo tròn xếp chồng rập khuôn, các badge pill rườm rà và từ ngữ thiếu tự nhiên (*"chuẩn mực"*, *"tiến bộ vững vàng"*).
  - Áp dụng hệ màu chuẩn giáo dục quốc tế: Nền Off-white ấm áp `#F8FAFC`, chữ Slate đậm `#0F172A`, màu nhấn Xanh Cobalt học thuật `#2563EB`.
- **Cột trái — Trực quan hóa phòng thi thật (Live Exam Workbench)**:
  - Hiển thị bản demo thu nhỏ của phòng thi IELTS máy tính: Trích đoạn bài đọc Reading với cụm từ được tô vàng (`<mark>`) kèm nhãn ghim dẫn chứng câu hỏi, kết hợp thẻ thông báo AI màu xanh lá phân tích chi tiết dẫn chứng và bản chất câu hỏi True/False/Not Given.
  - 3 Điểm nổi bật chuẩn xác:
    1. **Phòng thi máy tính chuẩn xác**: Giao diện và môi trường thi sát với kỳ thi thực tế.
    2. **Hệ thống AI giải thích lỗi sai cặn kẽ, chi tiết**: Dẫn chứng chính xác, phân tích cặn kẽ vì sao đúng / vì sao sai.
    3. **Kho đề Actual Tests phong phú, cập nhật liên tục**: Thư viện đề thi thực chiến phong phú được cập nhật liên tục.
- **Cột phải — Thẻ đăng nhập tinh gọn tuyệt đối**:
  - Tiêu đề **Đăng nhập** / **Sign in** dứt khoát, bỏ hoàn toàn câu phụ đề thừa thãi ("Nhập tài khoản học viên để vào làm bài").
  - Ô nhập liệu email & mật khẩu hiện đại, nút đăng nhập màu đen than chì (`#0F172A`) đầm chắc, tin cậy và chuyên nghiệp.

## Hệ Thống Phân Loại Dạng Bài Chuẩn (Unified IELTS & Integrated Taxonomy) & Popover Lọc Học Viên — 2026-10-25

- **Nguyên tắc an toàn bất khả xâm phạm (Zero-Breakage Runtime Constraint)**:
  - Tuyệt đối không thay đổi cách `ACTIVE_EXAM.txt`, hàm chấm `isSingleQuestionCorrect` hay `getQuizScoreSummary` sử dụng `q.type` và `q.subType`.
  - Bổ sung trường tùy chọn `categoryId?: string` cho `QuizQuestion` và `WritingTaskDefinition`.
  - Mọi thao tác lọc, biểu đồ điểm yếu Review, báo cáo Student Analytics, và thẻ vị trí Part/Passage đều đọc qua hàm thuần `inferQuestionCategory(q, quiz, sectionIdx)`.
- **4 Kỹ năng độc lập trong Taxonomy (`src/questionTaxonomy.ts`, `api/index.py`)**:
  - Tách hẳn `"Integrated"` thành danh mục kỹ năng riêng, không trộn lẫn vào `"Reading"`.
  - 10 dạng Listening: `L_FORM_NOTE`, `L_TABLE`, `L_SENTENCE_SUMMARY`, `L_FLOWCHART`, `L_SHORT_ANSWER`, `L_MAP_PLAN`, `L_DIAGRAM`, `L_MCQ_SINGLE`, `L_MCQ_MULTI`, `L_MATCHING`.
  - 12 dạng Reading: `R_TFNG`, `R_YNNG`, `R_MATCHING_HEADINGS`, `R_MATCHING_INFO`, `R_MATCHING_FEATURES`, `R_SENTENCE_ENDINGS`, `R_SUMMARY_BOX`, `R_NOTE_TABLE_SUMMARY`, `R_DIAGRAM_FLOWCHART`, `R_SHORT_ANSWER`, `R_MCQ_SINGLE`, `R_MCQ_MULTI`.
  - 12 dạng Writing: Task 1 (`W_T1_LINE`, `W_T1_BAR`, `W_T1_PIE`, `W_T1_TABLE`, `W_T1_MIXED`, `W_T1_MAP`, `W_T1_PROCESS`) và Task 2 (`W_T2_OPINION`, `W_T2_DISCUSSION`, `W_T2_ADV_DISADV`, `W_T2_PROBLEM_SOLUTION`, `W_T2_TWO_PART`).
  - 5 dạng Integrated: `I_LISTENING`, `I_CLOZE_GRAMMAR`, `I_ARRANGEMENT`, `I_READING_COMP`, `I_SENTENCE_TRANSFORM`.
- **Giao diện Lọc Dạng Bài (Bento Grid 2 Cột Mở Rộng) & Thẻ Đề Tinh Gọn (`src/components_split/STUDENT_PORTAL.txt`)**:
  - Tích hợp nút lọc nhỏ gọn cạnh ô tìm kiếm `[ Dạng bài (X) ▾ ]`, mở ra bảng popover dạng Bento Grid 2 cột (~540px) trực quan, hiển thị toàn bộ 100% tên các dạng bài mà không cần cuộn ngang hoặc cuộn dọc khó thao tác bằng chuột.
  - Từng ô dạng bài được thiết kế dạng card với checkbox tùy biến, tên dạng bài đầy đủ và huy hiệu đếm số đề thi khả dụng. Header có nút `[Bỏ chọn]` nhanh, footer hiển thị số đề thi khớp thực tế và nút `[Áp dụng]`.
  - Tinh gọn thẻ đề thi: Khi không lọc (`stSelectedCategories.length === 0`), ẩn hoàn toàn cụm tag dạng bài cồng kềnh để thẻ đề thi giữ layout gọn gàng, thanh lịch; khi lọc (`stSelectedCategories.length > 0`), hiển thị chính xác badge vị trí được lọc (ví dụ: `Part 2 · Map / Plan Labelling`).
- **Đồng bộ Exam Builder, Review Analytics & DOCX Parser (`EXAM_BUILDER.txt`, `REVIEW_QUIZ.txt`, `STUDENTS.txt`, `api/index.py`)**:
  - Exam Builder đổi sang selector Category chuẩn theo kỹ năng và thêm selector cho Writing Task 1 & 2.
  - Review Quiz và phân tích học viên hiển thị tên sư phạm chuẩn hóa.
  - DOCX Parser tự động nhận diện `sub_t` chuẩn (`TABLE`, `FORM`, `True/False/Not Given`, `Yes/No/Not Given`) và tính toán `categoryId` tự động.

## Gia Cố Bảo Mật Toàn Hệ Thống (6 Hạng Mục Security Audit & Hardening) — 2026-10-24

- **Hạng mục 1: Chống SSRF & Giả mạo MIME trong Proxy Ảnh / Audio (`api/index.py`)**:
  - Thêm `_is_blocked_ip_address`, `_validate_safe_external_url`, `_SafeRedirectHandler`, `_open_safe_external_url`, và `_detect_valid_image_mime`.
  - Chặn toàn bộ IP nội bộ, loopback (`127.0.0.1`, `::1`), link-local / cloud metadata (`169.254.169.254`), dải private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) và kiểm tra lại đích đến của mọi HTTP redirect (`301/302/303/307/308`) tại `/api/image_base64`, `_resolve_image_base64_part`, `_download_external_audio_to_file`, và `_download_external_audio_bytes`.
  - Xác thực magic bytes hình ảnh thực tế (`PNG`, `JPEG`, `GIF`, `WEBP`, `BMP`, `SVG`) trước khi trả dữ liệu từ `/api/image_base64` hoặc gửi sang Vision API.

- **Hạng mục 2: Phân quyền Firestore Security Rules & Cô lập Dữ liệu Nhạy cảm ở Client (`firestore.rules`, `firebase.json`, `src/App.template.tsx`)**:
  - Khởi tạo và đăng ký `firestore.rules` vào `firebase.json`: yêu cầu đăng nhập (`request.auth != null`) cho toàn bộ workspace, khóa quyền ghi các trường quản trị của giáo viên (`quizzes`, `transactions`, `history`, `schedules`, `examFolders`, `topicAssignments`, `realExamPackages`, `sharedLinks`, `giftCatalog`, `rewardMechanisms`, `bannedIps`, `announcement`) và các subcollection (`quizzes`, `audioUploads`, `examBulkOperations`) chỉ dành riêng cho tài khoản giáo viên (`@ielts.os`).
  - Tại `applyWorkspaceSnapshot` (`src/App.template.tsx`): Khi đăng nhập dưới vai trò `STUDENT`, tự động lược bỏ dữ liệu PII/tài chính nhạy cảm của các học viên khác (`phone`, `dob`, `rate`, `customRate`, `debtMessage`, `vocabNotebook`, `errorDna`) và ẩn sổ cái `transactions` khỏi bộ nhớ client.
  - Tại `performSyncData` (`src/App.template.tsx`): Ràng buộc học viên chỉ được phép thêm/cập nhật `quizResults` mang đúng `studentId` của chính mình.

- **Hạng mục 3: Xác thực & Rate-Limit các Endpoint AI, OCR và DOCX mà Không Giới hạn File Nhỏ (`api/index.py`, `src/App.template.tsx`, `src/WritingFeedback.tsx`, `storage.rules`)**:
  - Bổ sung `_verify_api_request_guard` kiểm soát Origin/Bearer Token Firebase kèm rate-limit theo IP cho `/api/upload_docx*`, `/api/scan_exam_page`, `/api/ai_critique`, `/api/ai_feedback`, `/api/ai_explain`, `/api/analyze_error_dna`, `/api/review_copilot`, `/api/ai_review_chat`, `/api/writing_sandbox_coach`, `/api/ai_vocab`, và `/api/image_base64`.
  - Bổ sung helper `getAuthHeaders` trong `src/App.template.tsx` và đính kèm `Authorization: Bearer <idToken>` trên toàn bộ lời gọi `fetch` tới backend API.
  - **Không giới hạn file ở mức 15 MB**: Nâng `MAX_DOCX_UPLOAD_BYTES` lên mặc định **100 MB** (cấu hình tối đa **512 MB**), `MAX_DOCX_UNCOMPRESSED_BYTES` lên **250 MB**, giữ nguyên khả năng upload file lớn cho `/api/scan_exam_page`, và nâng giới hạn audio trong `storage.rules` lên **512 MB** khớp với backend.

- **Hạng mục 4: Thu hẹp CORS trên Firebase Storage Bucket (`api/index.py`)**:
  - Thay thế cấu hình `origin: ["*"]` và phương thức `"DELETE"` trong `_ensure_storage_bucket_cors` bằng danh sách origin tin cậy `_audio_upload_cors_origins()` và các phương thức `["GET", "HEAD", "PUT", "POST", "OPTIONS"]`.
  - Chỉ truyền `origin` vào `create_resumable_upload_session` khi khớp với danh sách origin hợp lệ.

- **Hạng mục 5: Khử mã độc DOM XSS trong Bàn Chấm Writing & Xuất PDF (`src/WritingFeedback.tsx`)**:
  - Bọc `DOMPurify.sanitize(...)` cho `activeTask.prompt` (khi render `dangerouslySetInnerHTML`) và `params.taskPrompt` (trong `buildVectorPdfDossierHtml`), đồng thời dùng `escapeHtml(params.mediaUrl)`.

- **Hạng mục 6: HTTP Security Headers & So sánh Hằng thời gian cho Cron Secret (`vercel.json`, `api/index.py`)**:
  - Bổ sung `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, và `Permissions-Policy` vào `vercel.json`.
  - Sử dụng `hmac.compare_digest` khi kiểm tra `CRON_SECRET` tại `/api/maintenance/cleanup_attempts`.

## Sửa Lỗi Hiển Thị Chuỗi Thô `tx(...)` Trong Banner Gacha Mystery Box (Student Portal) — 2026-10-24

- **Vấn đề & Nguyên nhân gốc rễ**:
  - Trong `src/components_split/STUDENT_PORTAL.txt` (khối banner Lucky Gacha Spin), các lời gọi hàm đa ngôn ngữ `tx(...)` bị đặt trực tiếp như chuỗi văn bản tĩnh trong JSX mà thiếu cặp ngoặc nhọn `{...}` (ví dụ: `tx('Quay nhận ngẫu nhiên...', 'Roll for...')`, `tx('Chi phí', 'Cost')`, và `tx('Quay ngay', 'Roll Now')`).
  - Do thuộc tính `textTransform: 'uppercase'`, trình duyệt đã render nguyên văn chuỗi mã nguồn `TX('CHI PHÍ', 'COST')`, `tx('Quay ngay', 'Roll Now')` và nội dung mô tả lên giao diện.

- **Giải pháp**:
  - Bao bọc toàn bộ các hàm `tx(...)` thành biểu thức JSX `{tx(...)}` trong `src/components_split/STUDENT_PORTAL.txt`.
  - Chạy `python compile_app.py` ráp lại `src/App.tsx`, kiểm tra `tsc -b` và `vite build` 100% không lỗi.

## Sửa Lỗi Tê Liệt Tính Năng "AI Critique" Từng Câu Trong Bàn Chấm Writing (`Unable to generate AI critique: AI critique request failed:`) — 2026-10-21

- **Vấn đề & Nguyên nhân gốc rễ**:
  1. *Lỗi chuỗi rỗng `res.statusText` trên HTTP/2 (Vercel) che giấu lỗi thực tế*:
     - Trên giao thức HTTP/2 (mặc định trên Vercel Functions), thuộc tính `res.statusText` luôn trả về chuỗi rỗng `""`. Khi backend trả về lỗi non-2xx (400, 404, 422, 500), hàm frontend ném `throw new Error('AI critique request failed: ' + res.statusText)` khiến thông báo hiển thị cho người dùng bị cụt lửng thành `Unable to generate AI critique: AI critique request failed:`, hoàn toàn giấu nhẹm mã HTTP và nội dung lỗi từ backend.
  2. *Thiếu đồng bộ key dữ liệu giữa Frontend và Backend*:
     - `src/WritingFeedback.tsx` gửi payload với key `essay_text: originalEssay`, trong khi parser cũ trong `ai_feedback` chỉ tìm `context_text` hoặc `contextText`, khiến ngữ cảnh toàn bài văn bị rỗng `""`.
  3. *Lỗi JSON Mode trên các mô hình Groq/Cerebras*:
     - Khi gọi `_writing_eval_chat` hoặc `_groq_chat` với `json_mode=True`, các provider Groq/Cerebras thường trả về lỗi 400 `json_validate_failed` hoặc bọc output trong markdown code fences (` ```json ... ``` `) kèm thẻ `<think>...</think>`, khiến `json.loads` văng lỗi ngoại lệ mà không có cơ chế retry fallback.
  4. *Thiếu endpoint chuyên dụng `/api/ai_critique`*:
     - Hệ thống chỉ có route `/api/ai_feedback` tích hợp chung, thiếu các alias URL chuyên dụng như `/api/ai_critique`, `/api/writing/critique`.

- **Giải pháp triệt để**:
  1. *Backend endpoint chuyên dụng & fallback đa tầng (`api/index.py`)*:
     - Tạo hàm dùng chung `_execute_selection_critique(payload)` và đăng ký các routes: `@app.post("/api/ai_critique")`, `@app.post("/api/writing/critique")`, `@app.post("/api/writing_critique")`, đồng thời tích hợp vào nhánh `is_selection_critique` của `@app.post("/api/ai_feedback")`.
     - Trích xuất dữ liệu phòng vệ (defensive extraction) chấp nhận mọi biến thể key: `selectedText`/`selected_text`/`quote`/`anchorQuote`/`sentence`, `essayText`/`essay_text`/`fullText`/`essay`/`context`, `taskPrompt`/`prompt`/`question`, `taskNumber`/`task_number`, v.v.
     - Cơ chế retry 3 cấp độ: Cấp 1 gọi `_writing_eval_chat(..., json_mode=True)`; nếu lỗi lập tức thử Cấp 2 `_writing_eval_chat(..., json_mode=False)` và Cấp 3 `_groq_chat(..., json_mode=False)`.
     - Bộ phân giải `_clean_and_parse_critique_json`: bóc sạch `<think>`, gỡ markdown fences, trích xuất regex JSON an toàn kèm bộ phân tích ngữ pháp dự phòng (heuristic fallback), tuyệt đối không để crash 500.
     - Trả về payload đầy đủ chuẩn hóa: `criterion`, `category`, `type`, `label` ("Correction", "Less Natural", "Band 8.0+ Upgrade", "Praise"), `replacement`, `suggestedText`, `revisedText`, `highBandRewrite`, `comment`, `critique`, `explanation`, `note`, `tags`.
  2. *Frontend bắt lỗi an toàn & tự động lưu bản nháp (`src/WritingFeedback.tsx`)*:
     - Bóc tách `await res.json().catch(() => null)` trước khi kiểm tra `!res.ok || data?.success === false`, trích xuất thông tin lỗi chi tiết `data?.error || data?.detail || data?.message || "HTTP " + res.status`.
     - Gọi ưu tiên endpoint `/api/ai_critique` (với fallback sang `/api/ai_feedback` nếu 404).
     - Khi người dùng nhấn nút "Lưu ngay" (`autoSave=true`), tự động lưu comment vào `writingGrading` và kích hoạt `saveWritingGrade(false, nextGrading)` lưu ngay bản nháp vào hệ thống.
  3. *Kiểm thử & Biên dịch*:
     - Bổ sung 3 unit tests mới trong `tests/test_writing_ai_feedback.py` (`test_ai_critique_endpoint_and_aliases`, `test_ai_critique_fallback_without_json_mode`, `test_ai_critique_empty_selection_error`). 10/10 tests pass 100%.
     - `compile_app.py`, `tsc -b`, `vite build` pass 100% không cảnh báo lỗi.

## Nâng Cấp Writing AI Sandbox: Mở Khóa Cuộn Dọc, Tinh Gọn UI & Chuẩn Hóa 100% Academic English Band 8.5+ — 2026-10-20

- **Vấn đề & Nguyên nhân gốc rễ**:
  1. *Khóa cuộn dọc (Scroll Lock) khi mở AI Sandbox*:
     - Container cha `.writing-test-workspace` có `minHeight: 0, overflow: 'hidden'`, trong khi cột bên phải `.writing-test-answer` thiếu `overflowY: 'auto'`, `height: '100%'`, và `minHeight: 0`. Khi AI Sandbox mở ra và nở rộng nội dung, giao diện bị tràn khung nhìn và học sinh hoàn toàn không thể cuộn xuống để xem hoặc soạn bài.
     - Ô soạn thảo `<textarea>` thiếu `flexShrink: 0` và có `minHeight` thấp, dễ bị co rút khi AI Sandbox chiếm diện tích.
     - Nút chuyển Part (`←` / `→`) dùng `position: 'absolute', bottom: 30` dễ trôi lệch hoặc đè lên nội dung khi chiều cao thay đổi.
  2. *Giao diện AI Sandbox chiếm nhiều diện tích dọc (UI Bloat)*:
     - Hàng tab chuyển đổi và nút hành động nằm tách biệt trên nhiều dòng, kèm câu hướng dẫn dư thừa khiến thẻ AI chiếm hết nửa trên màn hình trước khi kịp hiển thị nội dung.
     - Nội dung AI phản hồi không giới hạn chiều cao, đẩy `<textarea>` xuống đáy trang.
  3. *Ngôn ngữ phản hồi tiếng Việt cứng nhắc trong AI Sandbox*:
     - Prompt trong `api/index.py` ép dịch sang tiếng Việt (`lang === 'vi'`) với câu chữ dịch máy thiếu tự nhiên, không phù hợp với ngữ cảnh luyện viết học thuật IELTS.

- **Giải pháp triệt để**:
  1. *Mở khóa cuộn dọc & chống đè giao diện (`src/components_split/ACTIVE_EXAM.txt`)*:
     - Cập nhật `.writing-test-answer`: `flex: 1, minWidth: 280, height: '100%', minHeight: 0, overflowY: 'auto', padding: '20px 24px 80px 18px', boxSizing: 'border-box', position: 'relative', display: 'flex', flexDirection: 'column'`.
     - Cập nhật `<textarea>`: `width: '100%', minHeight: 220, height: 260, flexShrink: 0, resize: 'vertical'`.
     - Cập nhật nút chuyển Part: `position: 'sticky', bottom: 16, alignSelf: 'flex-end', marginTop: 'auto', paddingTop: 16, zIndex: 10`, luôn ghim gọn gàng ở góc dưới phải và không bao giờ đè lên nội dung bài viết nhờ padding đáy 80px.
  2. *Thiết kế AI Sandbox siêu gọn gàng (Ergonomic & Compact UI)*:
     - Gộp tab chọn tính năng (`Perspectives & Collocations` | `Outline Logic Check`) và nút hành động chính (`Brainstorm Ideas` / `Check Logic`) trên cùng một hàng header duy nhất (`padding: '6px 10px', borderBottom: '1px solid #e5e7eb'`).
     - Lược bỏ hoàn toàn câu mô tả dư thừa để tối ưu không gian hiển thị.
     - Khung chứa nội dung có `maxHeight: '34vh'`, `overflowY: 'auto'`, và `overscrollBehavior: 'contain'`, cho phép cuộn độc lập mượt mà trong khi `<textarea>` của học sinh luôn hiện hữu ngay bên dưới.
     - Thẻ perspective thẻ hóa scannable: `padding: '8px 10px', marginBottom: 6, fontSize: 13, lineHeight: 1.42`, nhãn danh mục `10.5px`, pills collocations `padding: '4px 9px', fontSize: 12`.
  3. *Chuẩn hóa 100% Academic English Band 8.5+ (`api/index.py` & `src/App.template.tsx`)*:
     - Loại bỏ toàn bộ cờ ngôn ngữ tiếng Việt trong prompt Writing AI Sandbox. Yêu cầu mô hình sinh 100% tiếng Anh học thuật Band 8.5–9.0 tự nhiên, sắc sảo.
     - Phân định rõ ràng: Task 1 (tổng quan Overview sắc bén & gom nhóm dữ liệu logic), Task 2 (2–3 góc nhìn phản biện logic, topic sentence chuẩn mực và cơ chế chứng minh thực tế ngắn gọn), cùng 6–8 collocations/lexical chunks học thuật cao cấp.
     - Kiểm tra dàn ý (`critique_outline`): Đánh giá tính bao quát (Prompt coverage), độ mạch lạc (Logical progression), cảnh báo ngụy biện/khái quát hóa quá mức, và câu hỏi gợi mở tư duy (Socratic suggestions) hoàn toàn bằng tiếng Anh súc tích, mang tính xây dựng.

## Khắc Phục Lỗi Hiển Thị Ảnh Firebase Storage & SVG Thu Nhỏ 0x0 Trong Dạng Bài Map Labelling (`MAP_DRAG`) — 2026-10-18

- **Vấn đề & Nguyên nhân gốc rễ**:
  1. *Cắt cụt URL Firebase Storage do dấu ngoặc đơn hoặc HTML Entity*:
     - Biểu thức chính quy `url_re` trong `api/index.py` chứa ký tự đóng ngoặc `\)` trong tập loại trừ (`[^\s\]\)<>"\']`), dẫn đến việc các file ảnh trên Firebase Storage có tên chứa dấu ngoặc (ví dụ `campus%20(2).svg?alt=media&token=...`) bị cắt cụt ngay tại `)`, làm hỏng query token và gây lỗi tải ảnh.
     - Các entity HTML như `&amp;` trong query string `?alt=media&token=...` không được unescape triệt để, khiến request đến Firebase Storage bị từ chối hoặc trả về 403 Forbidden.
  2. *Mất câu hỏi khi đề bài thiếu thẻ `[SLOTS]`*:
     - Trong `process_map_drag_block`, nếu đề thi import từ DOCX chỉ có danh sách câu hỏi và đáp án (`18.`, `19.`, `20.`) nhưng thiếu hoặc bị lỗi block `[SLOTS]`, parser cũ bỏ qua hoàn toàn câu hỏi hoặc chuyển sai thành dạng khác, khiến các câu hỏi bị biến mất.
  3. *Mất URL ảnh khi chuyển đổi loại câu hỏi trong Exam Builder*:
     - Khi đổi `q.type` sang `MAP_DRAG`, thuộc tính `mapImageUrl` không được kế thừa từ `groupImageUrl` hay `diagramImageUrl`, làm mất link ảnh đã có sẵn.
  4. *SVG bị co rút kích thước thành 0px × 0px (SVG 0x0 Collapse)*:
     - Các file SVG trên Firebase Storage định nghĩa `viewBox` nhưng không có thuộc tính chiều rộng `width` cố định bằng pixel. Khi đặt CSS `display: inline-block; width: fit-content` trên khung chứa `.idp-map-drag-stage` và `.eb-map-drag-stage` kèm `width: auto` trên thẻ `<img>`, trình duyệt tính toán kích thước nội tại (intrinsic width) bằng 0, khiến ảnh SVG biến mất hoàn toàn.

- **Giải pháp triệt để**:
  1. *Chuẩn hóa URL ảnh toàn diện (`api/index.py` & `src/App.template.tsx`)*:
     - Cập nhật `url_re = re.compile(r'https?://[^\s\]<>"\']+', re.IGNORECASE)` trong cả `process_map_drag_block` và `process_diagram_label_block`, bảo toàn trọn vẹn URL chứa ngoặc đơn và query parameters của Firebase Storage.
     - Tự động unescape HTML entities (`&amp;` -> `&`) và chuẩn hóa khoảng trắng `%20` cho tất cả URL hình ảnh.
     - Bổ sung helper dùng chung `normalizeExternalMediaUrl` và `resolveQuestionMapUrl` trong `src/App.template.tsx`, giải quyết đa tầng nguồn ảnh: `mapImageUrl` -> `groupImageUrl` -> `diagramImageUrl` -> trích xuất từ `groupContext` / `instruction`.
     - Đồng bộ gán `question["mapImageUrl"] = group_image_url` bên cạnh `groupImageUrl` và `diagramImageUrl` trong `process_block`.
  2. *Tự động sinh slot mặc định khi thiếu `[SLOTS]`*:
     - Trong `process_map_drag_block`, cho phép nhận diện các dòng câu hỏi `18.`, `19.`, `20.` ngoài block slots.
     - Tự động tính toán và khởi tạo vị trí slot mặc định (`x: 50.0`, `y: 18.0 + idx * step`, `width: 16.0`, `height: 7.0`) cho bất kỳ câu hỏi nào chưa có tọa độ, đảm bảo 100% câu hỏi đều xuất hiện đầy đủ trên bản đồ.
  3. *Khắc phục triệt để lỗi SVG 0x0 Collapse (Exam Builder, Active Exam, Review)*:
     - `src/components_split/EXAM_BUILDER.txt`: Đặt `.eb-map-drag-stage` thành `width: 100%; maxWidth: 780px` và `<img>` thành `display: block; width: 100%; maxWidth: 100%; height: auto; maxHeight: 560px; objectFit: contain; margin: 0 auto`. Bổ sung `referrerPolicy="no-referrer"`.
     - `src/components_split/ACTIVE_EXAM.txt`: Đặt `.idp-map-drag-stage` thành `display: block; width: 100%; max-width: 820px; margin: 0 auto` và `<img>` thành `display: block; width: 100%; max-width: 100%; height: auto`.
     - `src/components_split/REVIEW_QUIZ.txt`: Đồng bộ `width: 100%; maxWidth: 100%; height: auto; objectFit: contain` cho thẻ `<img>` trong review stage.
  4. *Kế thừa dữ liệu ảnh mượt mà trong Exam Builder*:
     - Khi chuyển loại câu hỏi sang `MAP_DRAG`, tự động nạp `mapImageUrl` qua `resolveQuestionMapUrl(qItem)`.
     - Trong `getBuilderGroups`, so sánh `resolveQuestionMapUrl(qs[j]) === resolveQuestionMapUrl(q)` để nhóm các câu hỏi cùng bản đồ chuẩn xác.
  5. *Kiểm thử & Biên dịch*:
     - Bổ sung unit test `test_map_drag_firebase_url_and_fallback_slots` trong `tests/test_allow_option_reuse.py`. 5/5 tests pass 100%. Toàn bộ 30 backend tests pass.
     - `compile_app.py`, `npx tsc -b`, `npx vite build` pass 100% không cảnh báo lỗi.

## Tự Động Gom Nhóm Bộ Đề VOL & Đề Luyện Tập Mở Rộng Trong Phòng Thi Học Viên (Student Portal Exam Room) — 2026-10-18

- **Bối cảnh & Yêu cầu nghiệp vụ**:
  1. *Thiếu cấu trúc phân loại bộ đề*: Danh sách đề thi trong phòng thi học viên (`portalTab === "exams"`) trước đây hiển thị dàn phẳng theo kỹ năng (`Listening`, `Reading`, `Writing`), khiến học viên gặp khó khăn khi tìm kiếm các bài thi thuộc cùng một bộ đề (ví dụ Bộ VOL 6, VOL 7, VOL 8, VOL 9, VOL 10, hoặc chuỗi đề Writing W-1 -> W-12).
  2. *Không yêu cầu can thiệp dữ liệu thủ công (Zero Manual Data Edits)*: Toàn bộ đề thi trong Firestore đã được lưu với quy ước thư mục/tiêu đề tự nhiên (`LISTENING VOL 10`, `READING VOL [N]`, `VOL [N] TEST [N]...`, hoặc `W-[N]` cho Writing). Việc phân loại phải hoạt động động 100% bằng thuật toán nhận diện thông minh, không cần chạy script migrate database hay gán nhãn thủ công.
  3. *Lỗi sắp xếp bảng chữ cái (Naive Alphabetical Sort)*: Sắp xếp theo chuỗi mặc định xếp `Test 10` trước `Test 2` (`Test 1`, `Test 10`, `Test 2`...). Cần cơ chế sắp xếp số tự nhiên (Natural Numeric Sorting) để đảm bảo trình tự kiểm tra chuẩn xác (`Test 1 -> Test 2 -> ... -> Test 10`).

- **Giải pháp triệt để**:
  1. *Bộ nhận diện và phân loại động (`classifyStudentQuiz` & `extractQuizTestOrder`)*:
     - Nhận diện `VOL [N]` từ `quiz.folder` hoặc `quiz.title` (hỗ trợ cả các biến thể như `VOLUME [N]`, `VOL 9 TEST 1 ACADEMIC READING`,...).
     - Tự động gom toàn bộ đề Writing có dạng `W-[N]` (như `W-1`, `W-2`, `W-10`) vào nhóm bộ đề `VOL W` (`volKey: "VOL_W"`).
     - Phân định rạch ròi giữa bài thi thuộc chuỗi VOL (`isVolSeries: true`) và các đề luyện tập mở rộng/khác (`isVolSeries: false`).
     - Trích xuất thứ tự số học tự nhiên của bài thi (`testOrder`) và số thứ tự VOL (`volNumber`) phục vụ hàm so sánh `compareQuizzesNaturally`.
  2. *Thanh chọn VOL dạng viên thuốc tương tác (Interactive VOL Pill Selector)*:
     - Thanh cuộn ngang hiển thị các pill đại diện cho từng tập VOL (`VOL 6`, `VOL 7`, `VOL 8`, `VOL 9`, `VOL 10`, `VOL W`) kèm badge đếm số lượng đề đã hoàn thành trên tổng số đề (`X/Y đề`).
     - Tự động đổi màu chỉ thị thành công (xanh lá) khi học viên hoàn thành toàn bộ đề trong VOL.
     - Hỗ trợ tùy chọn "Tất cả VOL" ("ALL") để duyệt toàn bộ các tập VOL xếp chồng trực quan khi có nhiều hơn 1 bộ VOL.
     - Tự động ghi nhớ trạng thái VOL được chọn theo từng tab kỹ năng (`studentSelectedVolBySkill[studentExamSkillTab]`).
  3. *Khu vực đề thi Phần A (Bộ đề VOL) & Phần B (Đề luyện tập & Mở rộng)*:
     - Khung chứa bộ đề (VOL Container Card) hiển thị tiêu đề thư mục, thanh tiến độ hoàn thành trực quan (Progress Bar %) và danh sách thẻ bài thi.
     - Các đề không thuộc VOL được tách riêng sang Phần B ("Đề luyện tập & Mở rộng") phía dưới với số lượng đề rõ ràng.
     - Khi học viên gõ tìm kiếm (`stQuizSearch`), giao diện linh hoạt chuyển sang danh sách tìm kiếm phẳng được sắp xếp tự nhiên kèm badge nhận diện nhóm trên từng thẻ.
  4. *Nâng cấp thẻ bài thi và tab Kết quả & Review*:
     - Bổ sung huy hiệu tiến độ trực tiếp trên thẻ bài thi: nếu đã làm bài, hiển thị `✓ Đã làm · Band X (Y/Z)` cùng số lần làm bài.
     - Tab "Kết quả & Review" (`examRoomTab === "results"`): Tự động hiển thị huy hiệu VOL nhỏ gọn (`VOL 10`, `VOL 9`, `VOL W`, hoặc `Mở rộng`) cạnh tên đề `r.quizTitle` giúp học viên tra cứu lịch sử thi theo bộ đề trong nháy mắt.
  5. *Bảo toàn 100% logic cốt lõi & Quy chuẩn an toàn*:
     - Giữ nguyên toàn bộ logic khoá thiết bị (`isLockedByOtherDevice`), khoá bài thi (`isLocked`), kiểm tra SEB (`isSEBRequired`), mật khẩu đề thi (`passcode`), thời gian mở/đóng (`scheduledStart`/`scheduledEnd`), và gói thi tổng hợp `myRealExamPackages`.
     - `compile_app.py`, `npx tsc -b`, và `npx vite build` pass 100% không cảnh báo lỗi. Toàn bộ 29 unit tests pass.

## Khắc Phục Tái Sử Dụng Đáp Án Cho Dạng Matching 2 Cột Listening & Chuẩn Hóa 100% Giao Diện Sơ Đồ Quy Trình Flow-Chart Drag (IELTS CBT Parity) — 2026-10-18

- **Vấn đề & Nguyên nhân gốc rễ**:
  1. *Listening 2-Column Matching hiển thị sai giao diện radio Reading*: Các câu hỏi ghép đôi trong đề Listening (như match DVD categories với decisions) khi lưu dưới type `MATCHING` bị render nhầm thành bảng radio Reading (`renderMatchingTable()`) kèm legend phía dưới, thay vì giao diện kéo thả 2 cột chuẩn IDP (`idp-match2`).
  2. *Kho thẻ bị mất khi kéo thả nếu options.length >= questions.length*: Trong `idp-match2`, điều kiện cũ `reuseTags = group.questions.length > dragOptions.length` chỉ cho phép tái dùng phương án khi số câu nhiều hơn số đáp án. Trong thực tế, nhiều bài Listening cho phép dùng lại chữ cái ("You may use any letter more than once") hoặc đáp án đúng có lặp lại phương án dù `options.length >= questions.length`. Khi thí sinh kéo 1 thẻ, thẻ đó biến mất khỏi kho và không thể chọn lại cho câu khác.
  3. *Mất số thứ tự câu hỏi trong ô dropzone khi bỏ trống*: `src/App.template.tsx` chạy effect khôi phục DOM cho `.idp-dropzone`: `const displayVal = stateVal || dz.getAttribute('data-placeholder') || ""`. Do các thẻ dropzone trong `idp-match2` và `renderFlowChart` thiếu thuộc tính `data-placeholder`, khi ô chưa có câu trả lời hoặc bị xóa, `textContent` bị ghi đè thành chuỗi rỗng `""`, làm biến mất hoàn toàn số thứ tự câu hỏi (ví dụ 16–20 hoặc 21–25).
  4. *Khung Flow-Chart bị co giật kích thước không đồng đều và ô nhận đáp án bị ép nhảy dòng riêng*:
     - Khi dùng `width: fit-content`, mỗi hộp trong sơ đồ tự co theo độ dài câu văn dẫn tới kích thước các hộp lồi lõm không đồng đều (hộp 207px, hộp 157px).
     - Với hộp hẹp 157px, câu chứa ô điền như `Put [18] on the back` bị ép ngắt thành 3 dòng (`Put` / `[ 18 ]` / `on the back`), khiến ô dropzone trơ trọi một dòng.
     - `q.text` import từ DOCX chứa các thẻ `<br/>`, `\n` và gạch dưới kéo dài (`[16] ________`) chưa được bóc tách triệt để.

- **Giải pháp triệt để**:
  1. *Điều hướng tự động Listening Matching sang `idp-match2`*:
     - Định nghĩa `isListeningColumnMatching` cho các nhóm câu hỏi Matching trong Listening không kèm hình vẽ map/plan và không phải info matching.
     - Tự động bỏ qua `renderMatchingTable()` và render sang `idp-match2`.
  2. *Cơ chế tái dùng phương án linh hoạt (`reuseTags`)*:
     - Tính toán `reuseTags` đa điều kiện: `isListeningColumnMatching || explicitReuse || instructionAllowsReuse || hasDuplicateCorrectAnswers || group.questions.length > dragOptions.length`.
     - Nhận diện chỉ thị cho phép dùng lại trong đề thi ("more than once", "re-use"), phát hiện đáp án trùng lặp trong answer key, hoặc cờ `allowOptionReuse` từ Builder/parser.
     - Khi `reuseTags = true`, các thẻ trong kho không bị ẩn đi khi đã kéo thả.
     - Hỗ trợ kéo thẻ từ dropzone ngược về kho (`.idp-match2-bank` / `.idp-flowchart-bank`) để hủy chọn câu hỏi.
     - Bổ sung checkbox `Allow reusing options` trong `EXAM_BUILDER.txt` cho cả Column Drag và Flow-Chart Drag.
     - Bổ sung parser trong `api/index.py` nhận diện thẻ `[REUSE_OPTIONS]`, câu chỉ dẫn "more than once", hoặc trùng đáp án để tự động bật `allowOptionReuse: True`.
  3. *Bảo toàn số thứ tự câu hỏi khi trống*:
     - Thêm `data-placeholder={...}` và `data-num={...}` vào tất cả `.idp-dropzone` trong `idp-match2` và `renderFlowChart`.
     - Cập nhật effect khôi phục DOM trong `src/App.template.tsx` bỏ qua `.idp-summary-dropzone` để bảo vệ cấu trúc HTML bên trong.
  4. *Đồng bộ 100% quy chuẩn giao diện Flow-Chart chuẩn IELTS Computer-Delivered (IELTS CBT Parity)*:
     - **Triệt tiêu ép xuống dòng toàn cục (`src/index.css`)**: Thêm rule ưu tiên cao `.idp-flowchart-node .highlightable-content, .idp-flowchart-node .idp-flowchart-text, .idp-flowchart-node .idp-flowchart-text * { display: inline !important; }` và `.idp-flowchart-node br { display: none !important; }` để loại bỏ việc rule toàn cục `.highlightable-content { display: block !important; }` ép dropzone nhảy xuống dòng dưới nhãn tiền tố.
     - **Bảo toàn tiêu đề sơ đồ và các bước không đánh số (api/index.py)**: `process_flow_drag_block` bóc tách độc lập `flowTitle` (như *Plan for last lesson*) và tất cả các bước không đánh số `flowSteps` (cả trước và trong `[FLOW]`, ví dụ *(class) watch a movie*, *(small groups) have a discussion*), bỏ qua dòng mũi tên (`ARROW_LINE_RE`), giữ sạch phần chỉ dẫn thi `instruction_html`, và gắn `flowTitle`, `flowSteps` vào mọi câu hỏi của nhóm.
     - **Tương thích ngược cho đề đã tải lên (ACTIVE_EXAM.txt & REVIEW_QUIZ.txt)**: Tự động trích xuất tiêu đề sơ đồ và các bước không đánh số từ `group.instruction` nếu chưa có `q.flowSteps`, loại bỏ chúng khỏi `displayInstruction` và ẩn `group.context` để không tràn toàn màn hình.
     - **Bố cục 2 cột IDP chuẩn xác**: Cột trái `.idp-flowchart-panel` (`minmax(280px, 460px)`) chứa tiêu đề sơ đồ `.idp-flowchart-heading` căn giữa ở đỉnh, nối tiếp chuỗi hộp `.idp-flowchart-node` (viền `1px solid #4b5563`, bo góc `1px`, padding `8px 12px`, căn trái) kết nối bằng mũi tên đen đặc `.idp-flowchart-arrow` (`20px x 22px`). Kho thẻ từ vựng `.idp-flowchart-bank` ở cột phải tự động gióng hàng ngang thẳng tắp với đỉnh sơ đồ.
     - **Ô điền inline nằm trên cùng 1 dòng với chữ**: Đảm bảo khoảng trắng `" "` giữa `beforeText`, `.idp-dropzone` và `afterText` (ví dụ `(class) [ 26 ]`, `(pairs) [ 27 ]`), hiển thị liền mạch trên 1 dòng đơn.
     - Đồng bộ giao diện xem lại bài thi Review (`REVIEW_QUIZ.txt`) với cùng cấu trúc tiêu đề, bước không đánh số, viền hộp và badge inline.
  5. *Kiểm thử & Biên dịch*:
     - Bổ sung unit test `tests/test_allow_option_reuse.py` kiểm thử cả tái dùng đáp án và bóc tách `flowTitle` + `flowSteps`. 4/4 tests pass 100%. Toàn bộ 29 unit tests pass.
     - Kiểm thử giao diện trực tiếp qua Playwright: các hộp sơ đồ có cùng chiều rộng chuẩn xác 460px, văn bản và ô dropzone nằm trên cùng 1 dòng (độ lệch tâm Y < 1.5px), kho từ căn ngang bằng đỉnh sơ đồ.
     - `compile_app.py`, `npx tsc -b`, `npx vite build` pass 100% không cảnh báo lỗi.

## Chuẩn Hóa Phân Tích Bẫy Nhận Thức (AI Cognitive Trap Diagnosis) & Bảng Lựa Chọn Gây Nhiễu (Option Distractor Breakdown) — 2026-10-17

- **Vấn đề & Nguyên nhân gốc rễ**:
  1. *Trùng lặp tiền tố phương án (`A. A.`, `B. B.`)*: Options từ DOCX imports đã sẵn có tiền tố chữ cái (`"A. "`, `"B. "`), việc ghép thêm `${String.fromCharCode(65 + idx)}. ` trong frontend và backend khiến chuỗi bị lặp thành `"A. A. used up all the resources..."`.
  2. *Phương án đúng bị gán nhầm nhãn `ELIMINATE`*: `targetQ.correctAnswer` thường lưu dạng số (0, 1, 2) hoặc chuỗi số ("0", "1", "2"), hoặc mảng (`[0, 2]`), hoặc text thuần. Thuật toán so khớp cũ chỉ so khớp chuỗi chữ hoa với body hoặc prefix, bỏ sót việc đối chiếu index số hoặc định dạng mảng trắc nghiệm nhiều đáp án, khiến phương án đúng bị gán nhãn xám `ELIMINATE`.
  3. *Bẫy giả `"TRAP: No Audio Provided"` & điệp từ lặp `"Without the audio..."`*:
     - Chuỗi fallback lấy transcript cho câu Listening Part 2/3/4 bị đứt nếu `sections[qSectionIndex].passage` rỗng mà không kiểm tra `fullQuiz.passage`, `sections[0].passage` (nơi lưu full transcript của toàn bài nghe).
     - Khi backend nhận chuỗi ngữ cảnh rỗng, prompt thiếu guardrail cấm dẫn chứng tiêu cực khiến Gemini 2.5 Flash xuất ra `"TRAP: No Audio Provided"` và lặp đi lặp lại `"Without the audio, it's impossible to confirm or deny this statement..."` trên mọi phương án.
  4. *Xử lý câu học viên bỏ trống (Blank / Unanswered Questions)*: Khi học viên không chọn đáp án, AI xuất câu sáo rỗng vô dụng (`"The student's answer is blank, indicating they did not provide a response..."`) thay vì cung cấp hướng dẫn bắt nhịp từ khóa.

- **Giải pháp triệt để**:
  1. *Khử trùng lặp tiền tố phương án*:
     - Viết hàm `cleanOptionText` (TypeScript) và `_clean_option_text` (Python) lặp xóa triệt để mọi tiền tố chữ cái, số, ngoặc đơn, hai chấm (`/^\s*\(?[A-Za-z0-9]+[\.\)\:]\s*/`).
     - Render duy nhất một tiền tố chuẩn `${optLetter}. ${optBody}` trên giao diện Review (`REVIEW_QUIZ.txt`) và trong payload gửi sang AI (`src/App.template.tsx`), loại bỏ vĩnh viễn hiện tượng `A. A.`.
  2. *So khớp đa tầng chính xác 100% cho `CORRECT` và `ELIMINATE`*:
     - Xử lý đồng thời cả `CHOICE` và `CHOICE_MULTIPLE` cho `targetQ.correctAnswer` dưới mọi biểu diễn: số nguyên (`0`, `1`, `2`), chuỗi số (`"0"`, `"1"`), chữ cái (`"A"`, `"B"`), mảng (`[0, 2]`, `["A", "C"]`), chuỗi phân tách (`"A, C"`, `"A / C"`), và so khớp văn bản thân phương án + bản đồ TFNG (`True/False/Not Given`).
     - Phương án đúng: Luôn gắn badge xanh lá nổi bật `CORRECT` (`#dcfce7`, text `#15803d`, border `1px solid #86efac`) cùng viền và nền hàng dịu nhẹ (`#f0fdf4`, border `1px solid #bbf7d0`).
     - Phương án sai: Gắn badge xám `ELIMINATE` (`#f1f5f9`, text `#475569`). Nếu học viên đã chọn phương án sai này, hiển thị badge cảnh báo đỏ `YOUR CHOICE · ELIMINATE` (`#fee2e2`, text `#b91c1c`, border `1px solid #fca5a5`) cùng nền `#fff5f5`.
  3. *Chuỗi Fallback Transcript đa cấp & Guardrail chống "No Audio"*:
     - `src/App.template.tsx`: Tự động tìm kiếm transcript theo thứ tự ưu tiên: `sections[qSectionIndex].passage` -> `sections[qSectionIndex].passageHtml` -> `fullQuiz.passage` -> `fullQuiz.passageHtml` -> `sections[0].passage` -> `fullQuiz.transcript`. Đảm bảo Part 2, 3, 4 luôn có transcript đầy đủ gửi lên backend.
     - `api/index.py`: Thêm luật cấm tuyệt đối AI nhắc tới việc thiếu audio/transcript trong cả `sys_prompt` và `decon_sys`. Bắt buộc phân tích trực tiếp từ khóa và logic phương án.
     - Bộ lọc hậu xử lý (Post-processor) ở backend và frontend tự động quét sạch mọi biến thể của `"no audio"` / `"without audio"` và thay thế bằng phân tích bẫy từ khóa sư phạm chuẩn.
  4. *Nâng cấp sư phạm cho câu bỏ trống*:
     - Nhận diện trạng thái `isUnanswered`, chuyển đổi khung lỗi thành thẻ chiến thuật làm bài màu hổ phách (`#fffbeb`, viền trái cam `#f59e0b`, chữ nâu đậm `#92400e`) với tiêu đề "Chiến thuật xử lý câu bỏ trống: ".
     - AI hướng dẫn học viên cách bắt nhịp các từ chuyển tiếp (signpost markers) để không bị vuột mất thông tin khi nghe.
  5. *Kiểm thử & Biên dịch*:
     - Bổ sung 2 unit test trong `tests/test_ai_pedagogical_features.py`: `test_clean_option_text_helper` và `test_ai_explain_deconstruction_sanitization`. 8/8 tests pass 100%.
     - `compile_app.py`, `npx tsc -b`, và `npx vite build` đều pass 100% không cảnh báo lỗi.

## Phát mượt tức thì không trễ cho bài thi Listening (Zero-Latency Instant Audio Playback Engine) — 2026-10-17

- **Vấn đề & Nguyên nhân gốc rễ**:
  1. *Unmount/Remount `<audio>` muộn & `preload="metadata"`*: Phần tử `<audio ref={audioRef}>` trước đây chỉ được mount khi đã vào `activeExam` và sử dụng `preload="metadata"`. Trong suốt giai đoạn thí sinh ở màn hình chờ `PENDING_EXAM` hoặc xem video hướng dẫn `realExamInstructionGate`, audio không hề được tải trước các khối dữ liệu phát được (`HAVE_FUTURE_DATA`).
  2. *Range prewarm không hiệu quả*: Đoạn effect fetch 256 KB cũ kiểm tra `target.origin !== window.location.origin` (bỏ qua toàn bộ Firebase Storage và CDN ngoài) và dùng `cache: "no-store"`, khiến trình duyệt không thể tái sử dụng dữ liệu đã fetch cho thẻ `<audio>`.
  3. *`isOfflineReady` bỏ quên audio*: Chỉ đợi ảnh tải xong mà không kiểm tra xem buffer của audio đã sẵn sàng phát hay chưa.
  4. *Nghẽn click trong `requestManagedAudioPlayback`*: Gọi `warmAndroidAudioPath()` dạng `await` trước khi play trên desktop và gọi `.load()` làm reset decoder pipeline ngay khi thí sinh vừa click Play.

- **Giải pháp triệt để**:
  1. *Cột mốc `<audio ref={audioRef}>` bền vững (Persistent Hoisted Audio Portal)*:
     - Tính toán `preloadOrActiveAudioUrl` thống nhất xuyên suốt các trạng thái: `activeExam` (Listening/Integrated), `pendingExamState.quiz`, `realExamInstructionGate`, và `realExamSession`.
     - Render duy nhất một phần tử `<audio ref={audioRef}>` bền vững qua `createPortal(..., document.body)` với `key={preloadOrActiveAudioUrl}`, cấu hình `preload="auto"` để trình duyệt tự động buffer các chunk âm thanh ngay khi đang ở màn hướng dẫn/video.
     - Loại bỏ thẻ `<audio>` trùng lặp trong `ACTIVE_EXAM.txt`, loại trừ việc unmount/remount khi chuyển trạng thái làm mất buffer.
     - Tự động chèn dynamic `<link rel="preconnect">` và `<link rel="dns-prefetch">` vào `document.head` cho origin của file audio ngay khi biết URL.
  2. *Theo dõi trạng thái đệm thực tế (`isAudioReadyToPlay`)*:
     - Lắng nghe các sự kiện `onCanPlay`, `onCanPlayThrough`, `onProgress`, `onLoadedData`, `onLoadedMetadata`, `onTimeUpdate` kết hợp kiểm tra `audio.readyState >= 3` hoặc `audio.buffered.end(0) >= min(5, duration)`.
     - Fallback safety timer 6000ms chống treo trên các trình duyệt di động khắt khe (như iOS Safari).
     - Gỡ bỏ effect fetch 256 KB range vô dụng cũ.
  3. *Mồi luồng âm thanh trên cử chỉ người dùng trước overlay (Pre-Overlay Gesture Priming)*:
     - `PENDING_EXAM.txt`: Ràng buộc `isReadyToStart = isOfflineReady && isAudioReadyToPlay` trước khi hiện tích xanh và bật nút Start Test.
     - Khi thí sinh bấm "Start Test" (hoặc "Confirm and start Listening" trong Real Exam Gate), tận dụng gesture này để gọi `warmAndroidAudioPath()` và mồi `a.preload = "auto"; if (a.networkState === EMPTY) a.load();`.
  4. *Khởi phát Play tức thì (<50ms) & Nâng cấp UI Overlay*:
     - `requestManagedAudioPlayback`: Không bao giờ gọi `audio.load()` nếu `audio.readyState >= 1`. Chạy `void warmAndroidAudioPath()` non-blocking trên touch host, gọi `audio.play()` lập tức và set `setAudioStatus("PLAYING")` ngay khi promise resolve.
     - Màn hình chờ Inspera (`ACTIVE_EXAM.txt`): Phản ánh trạng thái trực quan — hiện spinner nhỏ `"Preparing audio..."` nếu buffer chưa đầy, hiện `"Starting..."` chống double click, và hiện nút Play trắng sắc nét khi audio đã sẵn sàng trong RAM, bấm là phát ngay lập tức.
  5. *Biên dịch & Kiểm thử*:
     - `python compile_app.py`, `npx tsc -b`, và `npx vite build` đều pass 100% không lỗi.

## Xử Lý Lỗi Vercel Deploy Quá Dung Lượng (Oversized Files & Deployment Payload Block) — 2026-10-17

- **Vấn đề & Nguyên nhân gốc rễ**:
  1. *Thiếu cấu hình `.vercelignore` & `.gitignore` cho môi trường Python*: Các thư mục môi trường ảo `.venv/` (334.69 MB), `.venv-1/` (36.36 MB), `.vercel_python_packages/` (55.73 MB) và agent tools `skills/` (14.84 MB) không được liệt kê trong `.vercelignore`. Khi deploy qua Vercel CLI (`vercel` / `vercel --prod`), toàn bộ payload hơn 490 MB bị đóng gói gửi lên Vercel, vượt xa ngưỡng 100 MB của Vercel dẫn đến lỗi từ chối upload (Payload Too Large).
  2. *Các file binary khổng lồ trong `.venv`*: `.venv/Lib/site-packages/playwright/driver/node.exe` (88.02 MB) và `.venv/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe` (83.58 MB) tiệm cận giới hạn dung lượng file đơn của Vercel.
  3. *Video hướng dẫn cũ không còn dùng trong `public/instruction-videos/`*: `reading-tutorial-v1.mp4` (19.41 MB) và `listening-tutorial-v1.mp4` (11.04 MB) là phiên bản cũ v1 không còn được import/sử dụng trong `App.template.tsx` (hiện đã dùng `v2` và `writing-tutorial-v1`), nhưng vẫn bị Vite bundle đẩy lên CDN làm phình dung lượng.

- **Giải pháp triệt để**:
  1. *Cập nhật `.vercelignore`*: Bổ sung loại trừ `.venv/`, `.venv*/`, `.vercel_python_packages/`, `.agents/`, `skills/`, `.claude/`, `.codex/`, `_vol9_test11_render/`, `tests/`, `*.docx`. Giảm ngay payload từ ~500 MB xuống < 10 MB mã nguồn thực tế.
  2. *Cập nhật `.gitignore`*: Bổ sung `.venv/` và `.venv*/` để tránh commit nhầm môi trường ảo local.
  3. *Dọn dẹp static assets*: Nhận diện các file video `v1` dư thừa để gỡ bỏ hoặc chuyển sang lưu trữ đám mây.

## Khắc Phục Lỗi Hiển Thị Ảnh Đề Thi & Vượt Rào Chặn Hotlink (Exam Image Rendering & Hotlink Bypass) — 2026-10-17

- **Vấn đề & Nguyên nhân gốc rễ**:
  1. *Cắt cụt query string trong `formatContent`*: Regex phân tích ảnh trước đây dừng đột ngột ngay sau đuôi file (`.png`, `.jpg`...), làm đứt query param `?alt=media&token=...` của Firebase Storage hoặc `?w=...` của CDN. Firebase Storage từ chối URL mất token với mã lỗi 403 Forbidden, khiến ảnh bị vỡ thành icon Visual Content.
  2. *Chặn Hotlink từ Host ngoài*: Các trang ảnh bên thứ ba (WordPress, Blogspot, Imgur, CDNs) kiểm tra HTTP `Referer` và từ chối cung cấp ảnh qua cross-origin hotlink nếu không có `referrerpolicy="no-referrer"`.
  3. *DOMPurify thanh trừng thuộc tính*: Danh sách `ALLOWED_ATTR` trong `sanitizeRichHtml` thiếu `"referrerpolicy"` và `"loading"`, dẫn tới việc các thuộc tính này bị xóa bỏ khi sanitize HTML.
  4. *Tiền tố định dạng và link Google Drive*: Các tiền tố `IMAGE: https://...` hoặc `Url: https://...` từ DOCX import cần được bóc tách sạch sẽ; các link xem trước Google Drive (`drive.google.com/file/d/.../view` hoặc `open?id=...`) cần được tự động chuyển đổi thành luồng ảnh trực tiếp (`drive.google.com/uc?export=view&id=...`).

- **Giải pháp triệt để**:
  1. *`src/App.template.tsx`*:
     - Bổ sung hàm chuẩn hóa `normalizeImageUrl` tự động chuyển đổi các link Google Drive dạng view/share thành direct image stream `https://drive.google.com/uc?export=view&id={id}`.
     - Cập nhật regex trong `formatContent` bảo toàn nguyên vẹn query string (`\?(?:[^\s<"']*)?` và `/o/...alt=media...`), đồng thời hỗ trợ nhận diện các tiền tố `IMAGE:` / `Url:` và sinh thẻ `<img>` kèm `referrerpolicy="no-referrer"` và `loading="lazy"`.
     - Bổ sung `"referrerpolicy"` và `"loading"` vào `ALLOWED_ATTR` của `sanitizeRichHtml` (DOMPurify).
     - Cập nhật `isSupportedRemoteImageUrl` và `renderRemoteImageHtml` hỗ trợ Google Drive và Firebase Storage URLs bảo đảm an toàn.
  2. *`src/components_split/ACTIVE_EXAM.txt`*:
     - Cập nhật `mapPlanImageHtml` tự động chèn `referrerpolicy="no-referrer"` và `loading="lazy"` vào mọi thẻ `<img>` trích xuất hoặc URL map/plan.
     - Cập nhật `stripMapPlanVisual` loại bỏ sạch tiền tố `(?:IMAGE|Url)\s*:\s*https?://...` tránh sót chữ thừa.
     - Bọc `cleanMediaUrl` với `normalizeImageUrl` và bổ sung `referrerPolicy="no-referrer"` `loading="lazy"` cho các thẻ `<img>` Map Labelling, Diagram và External Diagram visual.
  3. *`src/components_split/REVIEW_QUIZ.txt`*:
     - Đồng bộ `cleanMediaUrl` với `normalizeImageUrl` và bổ sung `referrerPolicy="no-referrer"` `loading="lazy"` cho các thẻ `<img>` trong chế độ xem lại bài thi.
  4. *Biên dịch & Kiểm thử*:
     - Biên dịch thành công qua `python compile_app.py`.
     - Kiểm tra `npx tsc -b` vượt qua 100% với 0 lỗi.


- **Khắc phục lỗi phương án Incorrect bị gắn nhãn nhầm thành CORRECT trong Why AI**:
  - *Nguyên nhân cốt lõi*: Trong `api/index.py` và `REVIEW_QUIZ.txt`, logic kiểm tra ban đầu sử dụng `is_corr = "CORRECT" in raw_status.upper() or "CORRECT" in raw_reason.upper()`. Tuy nhiên, từ tiếng Anh `"INCORRECT"` chứa nguyên vẹn chuỗi con `"CORRECT"`, hoặc đoạn giải thích lý do có chứa chữ "...not correct..." khiến mọi phương án sai đều bị đánh giá nhầm thành `true` và hiển thị huy hiệu `CORRECT` màu xanh.
  - *Giải pháp triệt để*:
    - Backend `api/index.py`: Kiểm tra loại trừ rõ ràng `is_elim = any(k in status_upper for k in ["ELIMINATE", "INCORRECT", "WRONG", "FALSE", "TRAP", "DISTRACTOR"])`, chỉ chấp nhận `is_corr = ("CORRECT" in status_upper and not is_elim)`. Đồng thời bổ sung bước đối chiếu xác định trực tiếp với đáp án chính thức (`correct`), đảm bảo nếu ký tự phương án (ví dụ `G`) khác với đáp án đúng (ví dụ `C`) thì 100% bắt buộc là `ELIMINATE`.
    - Phân tích tiền tố & thân phương án cho dạng True/False/Not Given & Yes/No/Not Given: Tách chuỗi dạng `C. NOT GIVEN` thành prefix `C` và body `NOT GIVEN`. Ánh xạ từ điển chuẩn hóa `tfngMap` (`T/TRUE`, `F/FALSE`, `NG/NOT GIVEN`, `Y/YES`, `N/NO`) để so khớp chính xác với đáp án của câu hỏi, chấm dứt hoàn toàn tình trạng cả 3 phương án TFNG đều bị ép thành `ELIMINATE`.
    - Frontend `REVIEW_QUIZ.txt`: Triển khai đồng bộ parser tiền tố và thân phương án kèm từ điển canonical `tfngMap`.
    - Unit test tự động: Bổ sung `test_distractor_breakdown_incorrect_never_marked_correct` và `test_distractor_breakdown_tfng_identifies_correct_option` trong `tests/test_manual_explanations.py`.

- **Khắc phục lỗi không thể cuộn lên (Scroll Up) trong Chat Copilot khi đang bật nghe Audio**:
  - *Nguyên nhân cốt lõi*: Khung chat sử dụng inline ref callback `ref={el => { if (el) { el.scrollTop = el.scrollHeight; } }}`. Khi audio bài nghe phát, sự kiện `timeupdate` kích hoạt 4 lần/giây (mỗi 250ms), làm `rvAudioCur` thay đổi và component cha re-render. Mỗi lần re-render, inline callback ref bị React gọi lại và cưỡng chế cuộn `el.scrollTop = el.scrollHeight;`, giật mạnh thanh cuộn xuống đáy khiến học sinh không thể cuộn lên xem tin nhắn trước đó.
  - *Giải pháp triệt để*: Chuyển sang `useRef` cố định (`copilotChatBoxRef` tại `App.template.tsx`), chỉ kích hoạt cuộn đáy trong `useEffect` khi có tin nhắn mới (`copilotMessages.length` tăng) hoặc khi mở hộp chat (`copilotOpen`), bảo toàn tuyệt đối vị trí cuộn thủ công của học sinh trong lúc nghe audio.

- **Tinh Gọn & Chuẩn Hóa Hiển Thị Markdown, Khắc Phục Lỗi Nhảy Transcript**:
  - *Khử vỡ dấu sao `**` và dẹp bỏ biển nút bấm tím*: Trước đây regex token chia tách chuỗi thô xung quanh ngoặc kép, cắt đứt các cụm in đậm (như `2. **"Problem" and "Suggestion" Pattern:**`) thành các mảnh rời không khép dấu `**`. Đồng thời mọi từ trong ngoặc kép độ dài >= 4 ký tự đều biến thành nút bấm tím khổng lồ, khiến các từ thông thường như `"Problem"`, `"Suggestion"` bị gán nhầm thành nút dẫn chứng.
  - *Parser Markdown phân tầng*:
    - Xử lý khối: Nhận diện chính xác tiêu đề (`###`), danh sách có thứ tự (`1.`, `2.`), danh sách dấu gạch đầu dòng (`-`, `*`) và đoạn văn bản.
    - Xử lý nội tuyến: Phân tách in đậm `**bold**` trước, đảm bảo markdown không bao giờ bị rách vỡ ký tự asterisks.
    - Bộ lọc dẫn chứng thông minh (`matchesSource`): Chỉ những trích dẫn văn bản thực tế từ bài đọc/transcript (độ dài >= 10 ký tự, >= 2 từ, không phải nhãn generic và có xuất hiện trong `rvSourceTextNormalized`) mới được chuyển đổi thành nút bấm dẫn chứng. Các từ ngữ giải thích thông thường được hiển thị dưới dạng dấu ngoặc kép typographic thanh lịch `“...”`.
    - Sửa lỗi nhảy vị trí transcript (`rvJumpToTranscript`): Loại bỏ việc vô cớ fallback về `blocks[0]` khi không tìm thấy trích dẫn, ngăn chặn triệt để tình trạng click vào từ ngữ bất kỳ bị cuộn giật về đầu bài nghe. Đồng thời đồng bộ `rvSeek` với `rvJumpToTranscript` để khi click mốc thời gian `[mm:ss]` vừa tua audio vừa cuộn transcript tới đúng dòng tương ứng.

## Tinh Gọn Giao Diện Why (AI) & Gia Sư IELTS AI Master Trò Chuyện Tự Do — 2026-10-16

- **Tinh Gọn Giao Diện Why (AI) Khắc Phục Lỗi Vỡ Layout**:
  - *Khử trùng lặp nội dung*: `rvCleanExplainText` tự động lọc bỏ các gạch đầu dòng liệt kê phương án (`* A. ...`, `* B. ...`) khỏi đoạn văn giải thích tổng quan khi đã có khối Distractor Breakdown, loại bỏ tình trạng giải thích bị nhân đôi quá dài.
  - *Sửa triệt để lỗi thẻ Option Distractor*: Chuẩn hóa dữ liệu phía backend (`api/index.py`) và frontend (`REVIEW_QUIZ.txt`) để huy hiệu trạng thái chỉ chứa nhãn súc tích `CORRECT` / `ELIMINATE` (thay vì nhồi nhét cả câu giải thích dài 20 từ vào huy hiệu nhỏ gây kéo giãn giao diện).
  - *Thay thế bảng Paraphrase bằng Tag Chips*: Chuyển đổi bảng HTML 3 cột cồng kềnh thành dàn thẻ chip flex bento bo góc tinh tế `[ Question Keyword ➔ Passage/Audio Clue | Note ]`, loại bỏ hiện tượng ô trống `--` và tiết kiệm 70% chiều cao màn hình.
  - *Chẩn đoán bẫy nhận thức sắc nét*: Badge `TRAP: ...` tông màu pastel đỏ nhạt kèm hộp nhận định lỗi tư duy có viền nhấn `borderLeft: 3px solid #ef4444`.

- **Nâng Cấp Gia Sư IELTS AI Master Độc Lập & Animation Mượt Mà**:
  - *Trò chuyện tự do không bắt buộc chọn câu*: Gỡ bỏ rào cản `if (!q) return;`. Học sinh có thể bấm nút nổi "Gia sư IELTS AI" bất kỳ lúc nào để trò chuyện tổng quan về toàn bộ bài thi, hỏi chiến thuật làm bài, phân tích bẫy đề lớn nhất, hoặc tra cứu từ vựng Band 8+.
  - *Ngữ cảnh toàn năng (Omniscient Exam Context)*: Backend `POST /api/review_copilot` tự động nạp toàn bộ danh sách câu hỏi làm sai, đáp án học sinh, đáp án đúng và bài đọc/transcript. Khi học sinh hỏi về bất kỳ câu nào trong chat (ví dụ: "giải thích câu 15"), AI tự động định vị và giải đáp chuẩn xác.
  - *Chuyển đổi ngữ cảnh linh hoạt*: Ghim câu hỏi (`[Q12]`) kèm nút `[✕ Bỏ ghim]` để quay lại chế độ toàn bài; dropdown chọn nhanh câu hỏi ngay tại thanh tiêu đề.
  - *Tương tác dẫn chứng & Audio trực tiếp*:
    - Trích dẫn văn bản dạng ngoặc kép `"..."` tự động trở thành nút bấm tương tác, click vào sẽ cuộn và highlight dẫn chứng trong bài đọc hoặc audio transcript.
    - Mốc thời gian `[mm:ss]` tự động trở thành nút phát audio trực tiếp từ giây tương ứng.
  - *Trải nghiệm cao cấp & Animation mượt mà*:
    - Hiệu ứng trượt nổi spring animation (`copilotPanelIn`, `copilotMsgIn`, `copilotWave` 3-dot typing).
    - Nút mở rộng cửa sổ (Expand/Collapse từ 425px lên 680px) để đọc phân tích sâu thoải mái trên màn hình lớn.
    - Đèn tín hiệu trạng thái trực tuyến (pulsing green beacon dot).

## Hệ Thống Điều Hướng URL Đa Tầng (Hierarchical URL Routing Engine) — 2026-10-16

- **Mục tiêu & Yêu cầu**:
  - Chuyển đổi mô hình URL phẳng (`/`) thành cấu trúc URL phân cấp rõ ràng theo từng phân hệ (Auth, System, Exam, Review, Student, Teacher), hỗ trợ deep linking, bookmark, chia sẻ link trực tiếp và nút Back/Forward của trình duyệt mà không làm mất trạng thái làm bài hoặc gián đoạn luồng thi cử.
  - Zero-dependency routing: Đồng bộ 2 chiều (Bidirectional Synchronization) hoàn toàn qua HTML5 History API (`pushState`, `popstate`), tương thích 100% với React 19 và SPA fallback của Vercel (`vercel.json`) cũng như Service Worker (`public/sw.js`).
- **Cấu trúc URL Chuẩn Hóa**:
  - **Auth & Public**:
    - `/login`: Đăng nhập hệ thống.
    - `/seb-guide`: Hướng dẫn cấu hình Safe Exam Browser (SEB).
  - **Phòng thi & Chấm thi**:
    - `/exam/:quizId`: Phòng thi IELTS máy tính (Listening, Reading, Writing, Integrated).
    - `/exam/:quizId/real-mock`: Chế độ thi thử Real Exam có kiểm soát nghiêm ngặt.
    - `/exam/review/:resultId`: Màn hình xem lại kết quả chi tiết của học sinh.
    - `/exam/writing-feedback/:resultId`: Học sinh xem bài chấm và phân tích lỗi Writing.
    - `/teacher/grading/:resultId`: Bàn chấm bài Writing của Giáo viên (Manuscript Editorial Desk).
  - **Phân hệ Học sinh (Student Portal)**:
    - `/student/dashboard`: Tổng quan bàn học, chuỗi ngày, OS Coins, Expression of the day.
    - `/student/exams`: Danh sách bài thi, bộ lọc kỹ năng, lịch sử làm bài.
    - `/student/quests`: Nhiệm vụ học tập theo chủ đề.
    - `/student/vocab`: Sổ tay từ vựng cá nhân (`vocabNotebook`).
    - `/student/rewards`: Cửa hàng đổi thưởng OS Coins.
    - `/student/progress`: Biểu đồ tiến độ và phân tích Error DNA.
  - **Phân hệ Giáo viên (Teacher Workspace)**:
    - `/teacher/dashboard`: Trung tâm điều hành & thống kê giáo viên.
    - `/teacher/exams`: Thư viện đề thi IELTS.
    - `/teacher/exams/:quizId`: Soạn/chỉnh sửa đề thi trong Exam Builder.
    - `/teacher/students`: Danh sách và quản lý học sinh.
    - `/teacher/students/:studentId`: Hồ sơ chi tiết học sinh và bản đồ Error DNA.
    - `/teacher/classes`: Quản lý lớp học và xếp chỗ.
    - `/teacher/arena`: Đấu trường trực tiếp Live Arena.
    - `/teacher/finances`: Quản lý học phí và sổ quỹ.
    - `/teacher/drive`: Lưu trữ tài liệu học tập.
    - `/teacher/quests`: Quản trị chuỗi bài tập và giao bài.
    - `/teacher/academics`: Quản lý giáo trình và học liệu.
    - `/teacher/history`: Nhật ký hoạt động hệ thống.
- **Cơ chế Kỹ thuật Triệt để**:
  - *Ánh xạ trạng thái -> URL (`computeCurrentPath`)*: Chuyển đổi trạng thái thực tế (`userRole`, `currentUser`, `activeExam`, `reviewQuiz`, `sebGuideQuiz`, `portalTab`, `activeTab`, `profileId`, `editingQuiz`) thành đường dẫn URL hợp lệ.
  - *Bộ phân tích & Áp dụng URL -> State (`applyRouteFromPath`)*: Tự động phân giải pathname khi tải trang hoặc popstate, khôi phục đúng tab, đề thi, hoặc hồ sơ tương ứng. Tích hợp Route Guards ngăn chặn học sinh truy cập `/teacher/*` (tự động điều hướng về `/student/dashboard`) và ngược lại.
  - *Bảo vệ Thí sinh Đang Thi (Exam In-Flight Guard)*: Khi thí sinh đang trong phòng thi (`activeExam`), nếu bấm nút Back trình duyệt, hệ thống chặn việc thoát vô tình và cảnh báo xác nhận `confirm(...)`, bảo toàn 100% câu trả lời và timer.
  - *Chống Vòng Lặp Vô Hạn (Loop Prevention)*: Kết hợp cờ `isRoutingPopStateRef` với so sánh nghiêm ngặt `window.location.pathname !== targetPath`, chỉ đẩy `history.pushState` khi pathname thực sự thay đổi.
  - *Khởi tạo An toàn (Initial Route Hydration)*: Cờ `initialRouteAppliedRef` chỉ cho phép hydrate pathname lần đầu sau khi dữ liệu (`loaded`, `currentUser`) đã sẵn sàng.

## 4 Tính Năng Sư Phạm AI Đột Phá (AI Pedagogical Core) — 2026-10-16

- **Feature 1: Chẩn đoán DNA Lỗi sai & Lỗ hổng Tư duy Tự động 100% (Error DNA & Weakness Diagnostic Engine)**:
  - *Cơ chế vận hành*: Tự động kích hoạt khi học sinh/giáo viên mở app hoặc khi nộp bài thi (`submitExam`), không cần bất kỳ thao tác click nút nào.
  - *Quét xác định 0ms (Deterministic Scanner)*: Hệ thống gom toàn bộ kết quả làm bài của học sinh, phân loại câu sai theo 8 dạng câu hỏi IELTS chuẩn (`CANONICAL_IELTS_TYPES`) và tạo signature duy nhất `${attempts}_${latestDate}_${totalQuestions}`.
  - *Chẩn đoán Nhận thức AI (`POST /api/analyze_error_dna`)*: Phân tích 15 lỗi sai thực tế gần nhất qua Vertex AI `gemini-2.5-flash` (fallback AI Studio/Groq/Cerebras), bóc tách 3 nhóm nguyên nhân nhận thức (Lexical Gap %, Distractor Trap %, Scope Misread % tổng 100%), định vị bẫy đề kinh niên kèm mức độ nghiêm trọng và kế hoạch hành động 7 ngày.
  - *Hiển thị đồng bộ*: Render thẻ chẩn đoán trực quan trong Hồ sơ học sinh của Giáo viên (`STUDENTS.txt`) và Bàn học cá nhân của Học sinh (`STUDENT_PORTAL.txt`), zero emoji, 100% song ngữ (`tx(vi, en)`).

- **Feature 2: Bộ Phân Tích Bẫy Đề 2.0 (Distractor Deconstructor 2.0 in Why AI)**:
  - *Nâng cấp Backend (`/api/ai_explain`)*: Bổ sung payload `deconstruction` có cấu trúc JSON mà vẫn giữ nguyên 100% tính tương thích ngược của `explanation` và `audioEvidence`.
  - *Frontend Review (`REVIEW_QUIZ.txt`)*:
    - Huy hiệu bẫy đề chuyên sâu (`TRAP: ...`) kèm chẩn đoán lý do chọn sai (`whyStudentWrong`).
    - Bảng ma trận đối chiếu từ khóa Paraphrase (Question Term <-> Passage/Transcript Term <-> Giải nghĩa).
    - Danh sách loại trừ từng phương án sai (Option Distractor Breakdown) gắn tag `CORRECT` / `ELIMINATE` và lý do bẫy.

- **Feature 3: Gia Sư AI 1-1 Cá Nhân Hóa (Interactive Review Copilot)**:
  - *Backend Endpoint (`POST /api/review_copilot`)*: Nhận câu hỏi đang review, ngữ cảnh bài đọc/transcript, bài làm học sinh, lịch sử chat và câu hỏi của học sinh. Trả về phản hồi sư phạm chính xác, trích dẫn văn bản bằng ngoặc kép `"...quote..."` hoặc mốc thời gian `[mm:ss]`.
  - *Frontend Dockable Drawer (`REVIEW_QUIZ.txt`)*: Nút nổi góc phải dưới màn hình xem lại + nút "Hỏi AI" ở từng câu hỏi. Hỗ trợ 3 prompt chip nhanh, cuộn chat mượt mà, và liên kết tương tác trực tiếp tới vị trí dẫn chứng trong bài đọc hoặc audio transcript.

- **Feature 4: Huấn Luyện Viên Dàn Bài & Ý Tưởng Writing Sandbox**:
  - *Kiểm soát thi cử chặt chẽ*: Toggle `allowWritingSandbox` trong Exam Builder (`EXAM_BUILDER.txt`). Tự động vô hiệu hóa tuyệt đối trong chế độ thi thật Real Exam.
  - *Backend Endpoint (`POST /api/writing_sandbox_coach`)*:
    - Tab 1 `mode: "brainstorm"`: Gợi ý các góc nhìn lập luận phản biện và 6-8 collocations học thuật C1/C2 Band 8+ theo ngữ cảnh đề bài.
    - Tab 2 `mode: "critique_outline"`: Kiểm tra tính mạch lạc và độ bao quát đề bài cho dàn ý 3-5 dòng của học sinh, cảnh báo suy diễn quá đà và đưa ra câu hỏi gợi mở Socratic.
  - *Frontend Drawer (`ACTIVE_EXAM.txt`)*: Thanh công cụ collapsible phía trên khung soạn thảo Writing Task 1 & Task 2.

- **Khắc phục lỗi Vercel Deploy (`Command "npm run build" exited with 2`)**:
  - *Nguyên nhân*: Lệnh build trên Vercel chạy `python3 compile_app.py && tsc -b && vite build`. `tsc -b` biên dịch theo `tsconfig.app.json` với chế độ Project References nghiêm ngặt. Khi tích hợp 4 tính năng AI, xuất hiện 5 điểm không khớp kiểu dữ liệu:
    1. `src/App.template.tsx` (dòng 4135–4137): `reviewQuiz.quiz` thiếu các thuộc tính động `readingPassages`, `transcript` -> fix bằng ép kiểu `(reviewQuiz.quiz as any)`.
    2. `src/App.template.tsx` (dòng 9221): `quiz.skill` là thuộc tính mở rộng không có trong `interface Quiz` chuẩn -> fix bằng `(quiz as any).skill`.
    3. `src/App.template.tsx` (dòng 11011): Biến `currentLang` chưa được khai báo ở scope hàm -> fix bằng `i18n.language === "vi"`.
    4. `src/components_split/REVIEW_QUIZ.txt` (dòng 450–520): Thuộc tính lồng nhau của `deconstruction` gây cảnh báo TS18048 (`possibly undefined`) -> bọc IIFE với fallback an toàn `const pPairs = Array.isArray(...) ? ... : []`.
    5. `src/components_split/ACTIVE_EXAM.txt` (dòng 1397): Tham chiếu biến không tồn tại `activeRealExamSession` -> fix bằng `!activeExam?.realExamContext`.
  - *Kết quả*: `compile_app.py`, `tsc -b`, và `vite build` đều vượt qua 100% với exit code 0 (`npm run build` pass sạch trên mọi môi trường CI/CD Vercel).

- **Khắc phục lỗi CORS/Network Upload Audio trong Exam Builder ("The browser could not reach secure audio storage")**:
  - *Nguyên nhân*: Trình duyệt thực hiện `PUT` trực tiếp lên GCS signed URL V4 (`storage.googleapis.com/...`). Request preflight `OPTIONS` bị chặn bởi CORS do Storage bucket chưa được áp dụng cấu hình CORS, và V4 signed URL không tự gắn header `Origin` của client.
  - *Giải pháp triệt để*:
    1. **Auto-Patch Bucket CORS (`_ensure_storage_bucket_cors`)**: Tự động cấu hình CORS trên bucket với các methods `GET, HEAD, PUT, POST, DELETE, OPTIONS` và headers `Content-Type, Content-Length, Content-Range, Range, ETag, x-goog-resumable, x-goog-meta-*`, lưu cache process-level an toàn qua `_BUCKET_CORS_CONFIGURED`.
    2. **GCS Resumable Upload Session với Origin Binding**: Trích xuất `request_origin` từ caller headers trong `POST /api/exam-audio/uploads`, tạo upload session trực tiếp qua `blob.create_resumable_upload_session(content_type, size, origin=request_origin)`. GCS tự động nhúng header `Access-Control-Allow-Origin: <origin>` cho preflight `OPTIONS` và `PUT` tức thì mà không phụ thuộc độ trễ cấu hình bucket. Tự động fallback sang `blob.generate_signed_url` nếu môi trường test/mock không hỗ trợ resumable session.
    3. **Lược bỏ Header thừa ở Client**: Chỉ gửi duy nhất header `Content-Type` khi gọi `xhr.setRequestHeader`, loại bỏ việc gửi các header tùy biến gây kích hoạt preflight kiểm tra khắt khe.
    4. **Tự động Fallback sang Firebase Client SDK (`uploadBytesResumable`)**: Khi trực tiếp `PUT` gặp lỗi CORS/network (`xhr.status === 0`), hệ thống tự động fallback tức thì sang `uploadBytesResumable(storageRef(storage, storagePath), file, { contentType })`, duy trì thanh tiến trình mượt mà và gọi endpoint `/complete` để cấp proxy URL `/api/audio/...` bảo mật.
    5. **Mở rộng `storage.rules`**: Cập nhật `match /exam-audio/{allPaths=**}` hỗ trợ đường dẫn đa phân đoạn `exam-audio/{uid_hash}/{upload_id}/{fileName}`.

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

## Academic Review Workbench & AI Source-Text Pipeline — 2026-10-24

- **Warm Editorial Review Workbench (`src/components_split/REVIEW_QUIZ.txt`)**:
  - Replaced legacy patchwork Review UI (keeping `isWritingQuiz` intact) with `.rv-workbench-root` (`--rv-bg: #FAF7F2`, `--rv-surface: #FFFFFF`, `--rv-border: #E6DFD3`, `--rv-ink: #1C1917`), using 100% inline SVG icons and zero emojis.
  - Default `reviewSectionIdx` is now `-1` (`Tổng quan` tab), rendering 3 stacked overview cards (`Phần kiểm tra` with conic-gradient Band Score donut and `Làm lại câu sai` mode, `Chi tiết bài thi`, and `Danh sách câu hỏi` 1–40 jump matrix + `Phân tích theo dạng câu hỏi`).
  - `Part 1..4` / `Passage 1..3` tabs (`reviewSectionIdx >= 0`) render a 50/50 resizable Split-Workbench with sticky Listening audio bar, multi-tier transcript/passage viewer, inline answer comparison slots (`.inline-ans-box` / `.dashed-drag-slot`), 4-button Inline Micro-Action Cluster (Lightbulb SVG, Location Pin SVG, Audio `[MM:SS]`, and `AI` button), and expandable `.inline-explain-drawer` directly beneath each question line without duplicate bottom `.rv-completion-detail` boxes.
  - Added minimalist free-form `Trợ lý AI` slide-over drawer (`380px`) initialized with `"Chào bạn, bạn cần hỗ trợ gì?"` and backed by `POST /api/ai_review_chat`.
- **AI Source-Text Resolution & Concise 3-Line Output (`src/App.template.tsx`, `api/index.py`)**:
  - Added `resolveReviewQuestionContext(q, quiz, activeSectionIdx)` in `src/App.template.tsx` with 4-tier source resolution (`sections[secIdx].transcript || sections[secIdx].passage` -> `passages[secIdx]` -> `quiz.transcript || quiz.passage` -> DOM fallback) and surrounding line extraction for `[BLANK]` questions whose `q.text` is only a number (`"1."`).
  - Updated `/api/ai_explain` in `api/index.py` to enforce a concise 3-bullet structure (`• Bản chất:`, `• Dẫn chứng:`, `• Kết luận:`, max 75–90 words) and never list untouched options `A–H`.

## Review Workbench Refinements, Practice Exit, Unified 3-State Save & Teacher Asset Confiscation — 2026-10-24

- **Review Workbench Simplification & Integrated MCQ Options Fix (`src/components_split/REVIEW_QUIZ.txt`, `src/App.template.tsx`)**:
  - Top Review header strictly shows two tabs (`Tổng quan` & `Chi tiết`); bottom Part/Passage navigator behaves identically to the active exam room (`ACTIVE_EXAM.txt`), showing question number pills inside the active bottom Part tab and `X of Y` counts for inactive tabs.
  - Fixed duplicated MCQ option text (`A–H`) on grouped range questions (`26–30`) in Integrated exams during Review by stripping shared `groupOptions` from per-question option pools when a shared group option box is already rendered or when `qOpts` matches the shared pool (`hasSharedPool`).
- **Practice Exam Exit Without Saving (`src/components_split/ACTIVE_EXAM.txt`, `src/App.template.tsx`)**:
  - Added `exitPracticeExamWithoutSaving` and a `← Quay lại` button in the exam room header for Practice exams (excluding Real Exam packages and locked non-practice quest stages). Requires user `confirm`, halts audio playback, resets exam session state, and returns to the portal without recording a result.
- **Unified 3-State Save System (`src/App.template.tsx`, `src/WritingFeedback.tsx`, `src/components_split/EXAM_BUILDER.txt`, `src/components_split/TOPIC_ASSIGNMENTS.txt`, `src/components_split/STUDENTS.txt`)**:
  - Standardized all save operations with: (1) inline loading state + disabled button (`examBuilderSaveState`, `keyEditorSaving`, `realExamPkgSaving`, `questEditorSaving`, `studentFormSaving`, `WritingFeedback.saveStatus`), (2) floating top-right toast banner (`showSaveToast` / `saveToastOverlay`), and (3) unsaved-changes guard (`beforeunload` + `confirmDiscardUnsavedChanges` on close/back/tab switch when dirty).
- **Quest Selector Deck, Store Item SVG Icons & Permanent Inventory Categories (`src/components_split/STUDENT_PORTAL.txt`, `src/App.template.tsx`)**:
  - Replaced vertical stacking of all Quests with a compact **Quest Selector Deck** (search input + `Tất cả / Đang thực hiện / Đã hoàn thành` filter tabs + grid of compact quest cards with progress bars), rendering only the selected quest's `.quest-split-layout` below.
  - Added `renderGiftStoreIcon` for distinct SVG artwork per reward/item type and sub-category filter pills (`Tất cả`, `Khung Avatar`, `Danh hiệu`, `Linh thú`, `Giao diện`, `Khác`) in the Permanent Inventory modal.
- **Teacher Confiscation & Anti-Resurrection Tombstone (`src/App.template.tsx`, `src/components_split/STUDENTS.txt`)**:
  - Extended `CoinOperation` (`revokedConsumables`, `revokedPermanents`, `revokedRewards`, `clearAllInventory`) and `Student.inventory.revokedPermanents`.
  - **Luật bất di bất dịch**: `mergeMyPermanents` and `performSyncData` union `permanents` across `localStorage` (`ielts_os_perms_<email>`), local state, and server state. When a teacher confiscates a permanent item via `applyCoinOperation`, its name is appended to `inventory.revokedPermanents` (and removed if re-granted later). Both `mergeMyPermanents` and `performSyncData` filter `permanents` against `revokedPermanents` before writing back to `localStorage` and Firestore so confiscated items never resurrect. Confiscating an equipped cosmetic also automatically unequips `equippedTitle`, `equippedTheme`, `equippedFrame`, or `equippedPet`.
