# IELTS OS — Session Handoff (cập nhật 2026-10-14)

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
