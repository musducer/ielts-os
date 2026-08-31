# Codex Output Optimization Rules

- **Chỉ xuất ra mã nguồn thay đổi**: Không viết lại toàn bộ file nếu chỉ sửa vài dòng. Chỉ dùng diff/Edit cho đúng đoạn cần sửa, không in lại code không đổi.
- **Không giải thích thừa**: Cắt bỏ lời chào, lời kết, và phần giải thích lý thuyết. Đi thẳng vào giải pháp.
- **Suy nghĩ ngắn gọn**: Phần suy luận chỉ tập trung phân tích lỗi/quyết định, không lan man.
- **Phong cách**: Súc tích như một kỹ sư senior bận rộn.

## Build note (quan trọng)
- `src/App.tsx` là **file tự sinh** khi build (`compile_app.py` ráp từ `src/App.template.tsx` + `src/components_split/*`). **Sửa code chính ở `App.template.tsx`**, không sửa trực tiếp `App.tsx` (sẽ bị build ghi đè).

## Kỷ luật cập nhật tài liệu (bắt buộc)
- Web có tính năng hoặc hành vi mới: cập nhật `README.md` trong cùng thay đổi.
- Hạ tầng, deploy, cache, lưu trữ, build hoặc quy chuẩn làm việc thay đổi: cập nhật `SESSION_HANDOFF.md` trong cùng thay đổi.
- Backend, API, parser hoặc quy trình bóc/tạo DOCX thay đổi: cập nhật `DOCX_FORMATTER_PLAYBOOK.md` trong cùng thay đổi.
- Không đánh dấu hoàn thành hoặc commit khi tài liệu thuộc phạm vi trên chưa được đồng bộ.

## Trước khi làm bất cứ gì — ĐỌC `SESSION_HANDOFF.md`
File `SESSION_HANDOFF.md` ở gốc repo ghi lại toàn bộ thay đổi + các bug nghiêm trọng đã fix (mất dữ liệu vocabNotebook, mất Highlight/Note khi chuyển passage, audio đứt do service worker) và luật bất di bất dịch rút ra từ đó. Đọc file này TRƯỚC khi sửa code, đặc biệt nếu user báo lỗi nghe giống bug tái diễn — nhiều khả năng nguyên nhân đã được ghi lại sẵn ở đó.
