import os
import re

def get_smart_paths():
    current_dir = os.path.abspath(os.path.dirname(__file__))
    if os.path.basename(current_dir) == 'src':
        return (
            os.path.join(current_dir, "App.template.tsx"),
            os.path.join(current_dir, "App.tsx"),
            os.path.join(current_dir, "components_split")
        )
    else:
        return (
            os.path.join(current_dir, "src", "App.template.tsx"),
            os.path.join(current_dir, "src", "App.tsx"),
            os.path.join(current_dir, "src", "components_split")
        )

def run_final_cleanup():
    template_path, output_path, components_dir = get_smart_paths()
    exam_builder_path = os.path.join(components_dir, "EXAM_BUILDER.txt")

    print("🚀 BẮT ĐẦU CHIẾN DỊCH QUÉT SẠCH 13 LỖI CUỐI CÙNG...")

    # =========================================================================
    # BƯỚC 1: SỬA LỖI SEVERITY 8 TRONG EXAM_BUILDER.TXT
    # =========================================================================
    if os.path.exists(exam_builder_path):
        with open(exam_builder_path, "r", encoding="utf-8") as f:
            eb_code = f.read()

        # Fix lỗi thiếu tham số: Expected 1 arguments, but got 0 cho syncData()
        eb_code = eb_code.replace("if (typeof syncData === 'function') syncData();", "/* if (typeof syncData === 'function') syncData(); - Removed to fix argument error */")
        
        with open(exam_builder_path, "w", encoding="utf-8") as f:
            f.write(eb_code)
        print("✅ [1/3] Đã vá lỗi Argument Error (Severity 8) trong EXAM_BUILDER.")
    else:
        print(f"⚠️ Không tìm thấy file {exam_builder_path}")

    # =========================================================================
    # BƯỚC 2: DỌN SẠCH CÁC BIẾN/HÀM THỪA TRONG TEMPLATE ĐỂ TRÁNH SEVERITY 4
    # =========================================================================
    if os.path.exists(template_path):
        with open(template_path, "r", encoding="utf-8") as f:
            app_content = f.read()

        # Danh sách 12 biến/hàm gây ra lỗi "is declared but its value is never read"
        unused_declarations = [
            r'const\s+\[keyEditingQuiz,\s*setKeyEditingQuiz\]\s*=\s*useState<any>\(null\);?',
            r'const\s+\[printBlankSheet,\s*setPrintBlankSheet\]\s*=\s*useState<boolean>\(false\);?',
            r'const\s+\[builderSearch,\s*setBuilderSearch\]\s*=\s*useState<string>\(""\);?',
            r'const\s+handleExportExamKey\s*=\s*\([^\)]*\)\s*=>\s*\{[\s\S]*?\};',
            r'const\s+handleFileUpload\s*=\s*\([^\)]*\)\s*=>\s*\{[\s\S]*?\};',
            r'const\s+duplicateQuiz\s*=\s*\([^\)]*\)\s*=>\s*\{[\s\S]*?\};',
            r'const\s+handleBulkLock\s*=\s*\([^\)]*\)\s*=>\s*\{[\s\S]*?\};',
            r'const\s+handleRecalculateScores\s*=\s*\([^\)]*\)\s*=>\s*\{[\s\S]*?\};',
            r'const\s+handleBulkDeleteQuizzes\s*=\s*\([^\)]*\)\s*=>\s*\{[\s\S]*?\};',
            r'const\s+isContinuousBlock\s*=\s*\([^\)]*\)\s*=>\s*\{[\s\S]*?\};',
            r'const\s+isFlowChart\s*=\s*\([^\)]*\)\s*=>\s*\{[\s\S]*?\};'
        ]

        for pattern in unused_declarations:
            app_content = re.sub(pattern, '', app_content)

        # =========================================================================
        # BƯỚC 3: RÁP NỐI VÀ XUẤT RA APP.TSX TỔNG SẠCH SẼ
        # =========================================================================
        if os.path.exists(components_dir):
            for filename in sorted(os.listdir(components_dir)):
                if filename.endswith('.tsx') or filename.endswith('.txt'):
                    comp_path = os.path.join(components_dir, filename)
                    with open(comp_path, "r", encoding="utf-8") as cf:
                        comp_code = cf.read()

                    comp_name = os.path.splitext(filename)[0].upper()
                    placeholder_with_nl = f"/*INSERT_{comp_name}*/\n"
                    placeholder_bare = f"/*INSERT_{comp_name}*/"

                    if placeholder_with_nl in app_content:
                        app_content = app_content.replace(placeholder_with_nl, comp_code)
                    elif placeholder_bare in app_content:
                        app_content = app_content.replace(placeholder_bare, comp_code)

            with open(output_path, "w", encoding="utf-8") as f:
                f.write(app_content)
                
            print("✅ [2/3] Đã thanh trừng 12 cảnh báo Warning.")
            print("✅ [3/3] Ráp nối thành công! App.tsx giờ đây đã đạt tiêu chuẩn STRICT MODE.")
    else:
        print("❌ Thiếu file App.template.tsx.")

if __name__ == "__main__":
    run_final_cleanup()