import os
import re

def fix_jsx_syntax():
    template_path = "src/App.template.tsx"
    output_path = "src/App.tsx"
    
    print("🚀 ĐANG SỬA LỖI CÚ PHÁP JSX PARSER...")

    if not os.path.exists(template_path):
        print(f"❌ Không tìm thấy file {template_path}")
        return

    with open(template_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. DỌN SẠCH CÁC KHỐI CSS LỖI BỊ KẸT BÊN NGOÀI DẤU BACKTICK
    content = re.sub(r'`}\s*/\* ========================================== \*/[\s\S]*?</style>', '`}</style>', content)
    content = re.sub(r'/\* ========================================== \*/[\s\S]*?</style>', '</style>', content)
    
    # 2. ĐƯA THẺ STYLE VỀ ĐỊNH DẠNG CHUẨN ĐÓNG AN TOÀN
    content = content.replace("`}</style>", "</style>")
    content = content.replace("</style>", "`}\n</style>")
    
    # 3. TIÊM LẠI CSS NHƯNG NẰM HOÀN TOÀN BÊN TRONG BACKTICK (CHUẨN JSX)
    safe_css = """
          /* ========================================== */
          /* MỞ KHÓA TOÀN BỘ ĐỊNH DẠNG TỪ RICH TEXT EDITOR */
          /* ========================================== */
          b, strong, .exam-content-block b, .exam-content-block strong, .idp-q-text-inline b, .idp-q-text-inline strong { font-weight: 900 !important; }
          i, em, .exam-content-block i, .exam-content-block em { font-style: italic !important; }
          u, .exam-content-block u { text-decoration: underline !important; }
          .ql-align-center, [style*="text-align: center"] { text-align: center !important; display: block !important; }
          .ql-align-right, [style*="text-align: right"] { text-align: right !important; display: block !important; }
          .ql-align-justify, [style*="text-align: justify"] { text-align: justify !important; display: block !important; }
          .idp-text-content, .highlightable-content, .idp-q-text-inline { text-align: inherit; display: block !important; }
          .idp-q-text-inline p, .idp-q-text-inline div { display: block !important; margin-bottom: 0.5em; }
    """
    
    content = content.replace("`}\n</style>", safe_css + "\n`}\n</style>")

    with open(template_path, 'w', encoding='utf-8') as f:
        f.write(content)
        
    # Ghi đè luôn vào App.tsx hiện tại để build được ngay
    if os.path.exists(output_path):
        with open(output_path, 'r', encoding='utf-8') as f:
            app_content = f.read()
            app_content = re.sub(r'`}\s*/\* ========================================== \*/[\s\S]*?</style>', '`}</style>', app_content)
            app_content = re.sub(r'/\* ========================================== \*/[\s\S]*?</style>', '</style>', app_content)
            app_content = app_content.replace("`}</style>", "</style>")
            app_content = app_content.replace("</style>", "`}\n</style>")
            app_content = app_content.replace("`}\n</style>", safe_css + "\n`}\n</style>")
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(app_content)

    print("🎉 Sửa lỗi JSX Parser thành công! Định dạng đã được bọc chuẩn.")

if __name__ == "__main__":
    fix_jsx_syntax()