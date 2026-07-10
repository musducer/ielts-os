import os

def compile_project():
    template_path = "src/App.template.tsx"
    output_path = "src/App.tsx"
    components_dir = "src/components_split"

    if not os.path.exists(template_path):
        print(f"❌ Không tìm thấy file mẫu cấu trúc: {template_path}")
        return

    print("🚀 Bắt đầu tiến trình gộp file tự động cho Vercel Production...")

    with open(template_path, 'r', encoding='utf-8') as f:
        content = f.read()

    if os.path.exists(components_dir):
        for filename in sorted(os.listdir(components_dir)):
            if filename.endswith('.tsx') or filename.endswith('.txt'):
                component_name = os.path.splitext(filename)[0]
                file_path = os.path.join(components_dir, filename)

                with open(file_path, 'r', encoding='utf-8') as cf:
                    component_code = cf.read()

                # Replace "/*INSERT_X*/\n" (including the placeholder's own newline)
                # so the content's trailing newline is the section separator
                placeholder_with_nl = f"/*INSERT_{component_name.upper()}*/\n"
                placeholder_bare    = f"/*INSERT_{component_name.upper()}*/"

                if placeholder_with_nl in content:
                    content = content.replace(placeholder_with_nl, component_code)
                    print(f"✅ Đã tiêm thành công hợp phần: {filename}")
                elif placeholder_bare in content:
                    content = content.replace(placeholder_bare, component_code)
                    print(f"✅ Đã tiêm thành công hợp phần: {filename}")
                else:
                    print(f"⚠️  Không tìm thấy placeholder cho: {filename}")

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"🎉 Ráp tệp hoàn tất! File sẵn sàng biên dịch: {output_path}")

if __name__ == "__main__":
    compile_project()
