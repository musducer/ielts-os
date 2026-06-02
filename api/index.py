import re
import io
import time
import traceback
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import docx
from docx.table import Table
from docx.text.paragraph import Paragraph

app = FastAPI(docs_url="/api/docs", openapi_url="/api/openapi.json")

app.add_middleware(
    CORSMiddleware, 
    allow_origins=["*"], 
    allow_credentials=True, 
    allow_methods=["*"], 
    allow_headers=["*"]
)

VALID_BLOCK_TYPES = ["BLANK", "CHOICE", "CHOICE_MULTIPLE", "MATCHING", "DRAG_DROP"]

def paragraph_to_html(para: Paragraph) -> str:
    if not para.text.strip(): return ""
    html_parts = []
    
    for run in para.runs:
        text = str(run.text) if run.text else ""
        if not text: continue
        text = text.replace('\n', '<br/>')
        
        if run.bold: text = f"<strong>{text}</strong>"
        if run.italic: text = f"<em>{text}</em>"
        if run.underline: text = f"<u>{text}</u>"
        html_parts.append(text)
        
    p_html = "".join(html_parts)
    
    align = para.alignment
    style_name = para.style.name.lower() if para.style else ""
    
    wrapper_style = ""
    if align == 1: wrapper_style += "text-align: center; "
    elif align == 2: wrapper_style += "text-align: right; "
    elif align == 3: wrapper_style += "text-align: justify; "
    
    if 'heading 1' in style_name: return f'<h1 style="{wrapper_style}margin: 15px 0; font-size: 24px;">{p_html}</h1>'
    if 'heading 2' in style_name: return f'<h2 style="{wrapper_style}margin: 12px 0; font-size: 20px;">{p_html}</h2>'
    if 'heading 3' in style_name: return f'<h3 style="{wrapper_style}margin: 10px 0; font-size: 18px;">{p_html}</h3>'
    
    if wrapper_style:
        return f'<div style="{wrapper_style}">{p_html}</div>'
        
    return p_html

def table_to_html(table: Table) -> str:
    rows = table.rows
    if not rows: return ""
    n_rows = len(rows)
    n_cols = len(rows[0].cells)
    html = '<table style="width:100%; border-collapse: collapse; margin-bottom: 15px;"><tbody>'
    for r_idx in range(n_rows):
        html += "<tr>"
        for c_idx in range(n_cols):
            cell = table.cell(r_idx, c_idx)
            cell_text = "".join([f"<div style='margin-bottom: 5px;'>{paragraph_to_html(p)}</div>" for p in cell.paragraphs if p.text.strip()])
            html += f'<td style="border: 1px solid #ccc; padding: 8px; vertical-align: top;">{cell_text}</td>'
        html += "</tr>"
    html += "</tbody></table>"
    return str(html)

def parse_docx_to_quiz(doc):
    title = "Untitled Mock Test"
    time_limit = 60
    quiz_type = "Reading"
    
    passage_parts = []
    images = []
    blocks = []
    
    current_block = None
    in_questions_section = False
    
    for element in doc.element.body:
        if element.tag.endswith('p'):
            para = Paragraph(element, doc)
            text = para.text.strip()
            if not text: continue
                
            if text.startswith("[TITLE]"):
                title = text.replace("[TITLE]", "").strip()
                continue
            elif text.startswith("[TIME]"):
                try: time_limit = int(text.replace("[TIME]", "").strip())
                except: pass
                continue
            elif text.startswith("[TYPE]"):
                quiz_type = text.replace("[TYPE]", "").strip()
                continue
            elif text.startswith("[QUESTIONS]"):
                in_questions_section = True
                continue
                
            if not in_questions_section:
                html_text = paragraph_to_html(para)
                if html_text: passage_parts.append(f"<div style='margin-bottom: 12px;'>{html_text}</div>")
            else:
                parsed_type = text.replace("[", "").replace("]", "").strip()
                if parsed_type in VALID_BLOCK_TYPES or parsed_type == "CONTEXT":
                    if current_block: blocks.append(current_block)
                    current_block = {"type": parsed_type, "lines": []}
                elif text == "[/CONTEXT]":
                    if current_block and current_block["type"] == "CONTEXT":
                        blocks.append(current_block)
                        current_block = None
                else:
                    if current_block: current_block["lines"].append(para)
                    
        elif element.tag.endswith('tbl') and in_questions_section:
            tbl = Table(element, doc)
            if current_block: current_block["lines"].append(tbl)

    if current_block: blocks.append(current_block)

    parsed_questions = []
    q_index = 1
    global_context = "" 
    
    for block in blocks:
        b_type = block["type"]
        lines = block["lines"]
        
        if b_type == "CONTEXT":
            for item in lines:
                if isinstance(item, Paragraph): global_context += f"<div style='margin-bottom: 8px;'>{paragraph_to_html(item)}</div>"
                elif isinstance(item, Table): global_context += table_to_html(item)
            continue
        
        if b_type in VALID_BLOCK_TYPES:
            instruction = ""
            group_context = global_context
            global_context = "" 
            
            current_q = None
            questions_in_block = []
            block_options = []
            
            for item in lines:
                is_para = isinstance(item, Paragraph)
                text_line = item.text.strip() if is_para else "[TABLE]"
                html_line = paragraph_to_html(item) if is_para else table_to_html(item)
                
                if not text_line: continue
                lower_line = text_line.lower()
                
                if not current_q:
                    if not re.match(r'^[a-z][\.\)]\s+', text_line) and any(kw in lower_line for kw in ["mark ", "read ", "label ", "complete ", "choose ", "write "]):
                        instruction += html_line + "<br/>"
                        continue
                    if re.match(r'^[A-Z][\.\)]\s+', text_line) or text_line in ["TRUE", "FALSE", "NOT GIVEN", "YES", "NO"]:
                        block_options.append(text_line)
                        continue
                
                # BẢN VÁ REGEX CÂU HỎI: Ép buộc số không có chữ Question phải có dấu chấm hoặc ngoặc
                if re.match(r'^(?:(?:Question|Câu(?: hỏi)?)\s*\d+[\.\:\)]?|\d+[\.\:\)])(?:\s+|$)', text_line, re.IGNORECASE) or text_line.startswith("________"):
                    if current_q: questions_in_block.append(current_q)
                    current_q = {"text": f"<div style='margin-bottom: 8px;'>{html_line}</div>", "options": [], "correctAnswerStr": "", "correctAnswerStrs": [], "type": b_type}
                    continue
                    
                if current_q:
                    if text_line.startswith("*"):
                        ans_clean = re.sub(r'^\*+\s*', '', text_line).strip()
                        ans_clean_no_prefix = re.sub(r'^[A-Za-z][\.\)]\s*', '', ans_clean).strip()
                        
                        if b_type == "CHOICE_MULTIPLE":
                            current_q["correctAnswerStrs"].append(ans_clean_no_prefix)
                            if not block_options and (re.match(r'^[A-Z][\.\)]\s+', ans_clean) or ans_clean in ["TRUE", "FALSE", "NOT GIVEN", "YES", "NO"]):
                                current_clean_opts = [re.sub(r'^[A-Za-z][\.\)]\s*', '', o).strip() for o in current_q["options"]]
                                if ans_clean_no_prefix not in current_clean_opts:
                                    current_q["options"].append(ans_clean)
                                
                        elif b_type in ["CHOICE", "MATCHING"]:
                            current_q["correctAnswerStr"] = ans_clean_no_prefix
                            if not block_options and (re.match(r'^[A-Z][\.\)]\s+', ans_clean) or ans_clean in ["TRUE", "FALSE", "NOT GIVEN", "YES", "NO"]):
                                current_clean_opts = [re.sub(r'^[A-Za-z][\.\)]\s*', '', o).strip() for o in current_q["options"]]
                                if ans_clean_no_prefix not in current_clean_opts:
                                    current_q["options"].append(ans_clean)
                                
                        else:
                            current_q["correctAnswerStr"] = ans_clean
                            
                    elif b_type in ["CHOICE", "MATCHING", "CHOICE_MULTIPLE", "DRAG_DROP"] and (text_line in ["TRUE", "FALSE", "NOT GIVEN", "YES", "NO"] or re.match(r'^[A-Z][\.\)]\s+', text_line)):
                        if not block_options:
                            current_q["options"].append(text_line)
                    else:
                        current_q["text"] += f"<div style='margin-bottom: 8px;'>{html_line}</div>"
                else:
                    group_context += f"<div style='margin-bottom: 8px;'>{html_line}</div>"
                    
            if current_q: questions_in_block.append(current_q)
                
            for idx, q in enumerate(questions_in_block):
                # VÁ REGEX CẮT SỐ CÂU HỎI TRONG TEXT
                q_text_clean = re.sub(r'^(<div[^>]*>)?(<[^>]+>)?(?:(?:Question|Câu(?: hỏi)?)\s*\d+[\.\:\)]?|\d+[\.\:\)])(?:\s+|$)', r'\1\2', q["text"], flags=re.IGNORECASE).strip()
                
                if not q["options"] and block_options:
                    q["options"] = block_options.copy()
                    
                correct_ans_idx = -1
                options_payload = None
                cleaned_options = [re.sub(r'^[A-Za-z][\.\)]\s*', '', opt).strip() for opt in q["options"]]
                
                if b_type in ["CHOICE", "MATCHING"]:
                    options_payload = cleaned_options if cleaned_options else ["TRUE", "FALSE", "NOT GIVEN"]
                    try: 
                        correct_ans_idx = cleaned_options.index(q["correctAnswerStr"])
                    except ValueError:
                        matched = False
                        target_char = q["correctAnswerStr"].upper().replace(".", "").replace(")", "").strip()
                        if len(target_char) == 1 and target_char.isalpha():
                            for o_idx, opt_raw in enumerate(q["options"]):
                                if opt_raw.upper().startswith(f"{target_char}.") or opt_raw.upper().startswith(f"{target_char})"):
                                    correct_ans_idx = o_idx
                                    matched = True
                                    break
                        if not matched and options_payload: correct_ans_idx = 0
                        
                elif b_type == "CHOICE_MULTIPLE":
                    options_payload = cleaned_options
                    correct_ans_idx = []
                    for ans in q.get("correctAnswerStrs", []):
                        try:
                            correct_ans_idx.append(cleaned_options.index(ans))
                        except ValueError:
                            target_char = ans.upper().replace(".", "").replace(")", "").strip()
                            if len(target_char) == 1 and target_char.isalpha():
                                for o_idx, opt_raw in enumerate(q["options"]):
                                    if opt_raw.upper().startswith(f"{target_char}.") or opt_raw.upper().startswith(f"{target_char})"):
                                        correct_ans_idx.append(o_idx)
                                        break
                    correct_ans_idx = list(set(correct_ans_idx))
                    
                elif b_type in ["BLANK", "DRAG_DROP"]:
                    options_payload = cleaned_options if cleaned_options else None
                    correct_ans_idx = q["correctAnswerStr"]
                
                parsed_questions.append({
                    "id": f"q_{q_index}",
                    "type": b_type,
                    "instruction": instruction if instruction else None,
                    "groupContext": group_context if idx == 0 and group_context else None,
                    "text": q_text_clean,
                    "options": options_payload,
                    "correctAnswer": correct_ans_idx
                })
                q_index += 1

    return {
        "id": f"quiz_{int(time.time() * 1000)}",
        "title": title,
        "type": quiz_type,
        "timeLimit": time_limit,
        "passage": "".join(passage_parts),
        "images": images,
        "questions": parsed_questions,
        "active": False,
        "maxAttempts": 1,
        "audience": "ALL",
        "targetStudentIds": []
    }

@app.post("/api/upload_docx")
async def upload_docx(file: UploadFile = File(...)):
    try:
        doc = docx.Document(io.BytesIO(await file.read()))
        quiz = parse_docx_to_quiz(doc)
        
        if not quiz.get("questions") or len(quiz["questions"]) == 0:
            debug_lines = [p.text for p in doc.paragraphs if p.text.strip()][:5]
            return {"success": False, "error": f"LỖI TEXT: Không thể trích xuất câu hỏi. Hãy đảm bảo file Word chứa một trong các block: {', '.join([f'[{t}]' for t in VALID_BLOCK_TYPES])}. Đầu vào mẫu: {debug_lines}"}
            
        return {"success": True, "quiz": quiz}
    except Exception as e:
        return {"success": False, "error": f"CRITICAL CRASH:\n{str(e)}\n{traceback.format_exc()}"}

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "timestamp": time.time()}