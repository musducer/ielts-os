# -*- coding: utf-8 -*-
import io
p = "src/App.template.tsx"
c = io.open(p, "r", encoding="utf-8").read()

start_anchor = "  const exportCSV = () => {"
end_anchor = "link.download = `DETAILED_${r.studentName}_${r.quizTitle}.csv`; link.click();\n  };"
i = c.index(start_anchor)
j = c.index(end_anchor) + len(end_anchor)

new_block = r"""  // Xuất Excel (.xlsx) định dạng đẹp: tiêu đề, header xanh đậm, zebra, freeze, auto-filter.
  const downloadXLSX = async (filename: string, sheetName: string, columns: { header: string; width: number }[], rows: (string | number)[][], title?: string) => {
      const mod: any = await import('exceljs');
      const ExcelJS: any = mod.default || mod;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'IELTS OS';
      const ws = wb.addWorksheet(sheetName);
      columns.forEach((cc, idx) => { ws.getColumn(idx + 1).width = cc.width; });
      let hr = 1;
      if (title) {
          ws.mergeCells(1, 1, 1, columns.length);
          const tc = ws.getCell(1, 1);
          tc.value = title;
          tc.font = { bold: true, size: 16, color: { argb: 'FF1E3A8A' } };
          tc.alignment = { horizontal: 'center', vertical: 'middle' };
          ws.getRow(1).height = 28;
          hr = 2;
      }
      const headerRow = ws.getRow(hr);
      columns.forEach((cc, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value = cc.header;
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          cell.border = { bottom: { style: 'thin', color: { argb: 'FF3B82F6' } } };
      });
      headerRow.height = 24;
      rows.forEach((arr, ri) => {
          const row = ws.getRow(hr + 1 + ri);
          arr.forEach((v, ci) => {
              const cell = row.getCell(ci + 1);
              cell.value = v as any;
              cell.alignment = { vertical: 'middle', wrapText: true, horizontal: typeof v === 'number' ? 'center' : 'left' };
              cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
              if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          });
      });
      ws.views = [{ state: 'frozen', ySplit: hr }];
      ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: hr, column: columns.length } };
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click();
  };

  const exportCSV = () => {
      const cols = [{header:'Ngày', width:14},{header:'Học viên', width:22},{header:'Giáo viên', width:18},{header:'Kỹ năng', width:24},{header:'Thời lượng (phút)', width:16},{header:'Học phí', width:14},{header:'Trạng thái', width:12}];
      const rows: (string|number)[][] = history.map(h => [h.date, h.studentName, h.teacher, (h.skills||[]).join(' - '), Math.round((h.duration||0)/60), h.earnings||0, h.isPaid ? 'Đã thu' : 'Chưa thu']);
      downloadXLSX('IELTS_BAO_CAO_BUOI_HOC.xlsx', 'Báo cáo', cols, rows, 'BÁO CÁO BUỔI HỌC');
  };

  const exportStudentsCSV = () => {
      const cols = [{header:'Họ tên', width:24},{header:'Email', width:26},{header:'Trình độ', width:10},{header:'Mục tiêu', width:10},{header:'Học phí/giờ', width:14},{header:'Còn nợ', width:14}];
      const rows: (string|number)[][] = students.map(s => {
          const sDebt = history.filter(h => h.studentId === s.id && !h.isPaid).reduce((sum, h) => sum + (h.earnings||0), 0);
          return [s.name, s.email||'', s.cefr, s.target, s.rate, sDebt];
      });
      downloadXLSX('IELTS_DANH_SACH_HOC_VIEN.xlsx', 'Học viên', cols, rows, 'DANH SÁCH HỌC VIÊN');
  };

  const exportQuizResultsCSV = () => {
      const cols = [{header:'Ngày', width:14},{header:'Học viên', width:22},{header:'Đề thi', width:26},{header:'Điểm', width:10},{header:'Band', width:8},{header:'Gian lận', width:9},{header:'Thời gian (s)', width:12},{header:'IP', width:14},{header:'Thiết bị', width:20},{header:'Nhận xét GV', width:30}];
      const rows: (string|number)[][] = quizResults.map(r => [r.date, r.studentName, r.quizTitle, `${r.score}/${r.total}`, r.band, r.cheatCount, r.durationSeconds||0, r.ipAddress||'', r.deviceInfo||'', r.teacherFeedback||'']);
      downloadXLSX('IELTS_KET_QUA_THI.xlsx', 'Kết quả', cols, rows, 'KẾT QUẢ THI CBT');
  };

  const exportDetailedQuizResult = (r: QuizResult) => {
      const qz = quizzes.find(x => x.id === r.quizId);
      if (!qz) { alert('Không tìm thấy dữ liệu đề gốc!'); return; }
      const strip = (t: any) => String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const rows: (string|number)[][] = qz.questions.map((q, i) => {
          const options = q.options || [];
          let correctDisplay: any = q.correctAnswer;
          let studentDisplay: any = (r.answers && r.answers[q.id] !== undefined) ? r.answers[q.id] : '';
          let isCorrect = 'Sai';
          if (q.type === 'CHOICE' || q.type === 'MATCHING') {
              correctDisplay = options[q.correctAnswer as number] || q.correctAnswer;
              studentDisplay = (r.answers && r.answers[q.id] !== undefined) ? (options[r.answers[q.id] as number] || '') : '';
              if (r.answers && r.answers[q.id] === q.correctAnswer) isCorrect = 'Đúng';
          } else {
              const sAns = String(studentDisplay).trim().toLowerCase();
              const correctStrs = String(q.correctAnswer).split('/').map((s: string) => s.trim().toLowerCase());
              if (correctStrs.includes(sAns)) isCorrect = 'Đúng';
          }
          return [i+1, strip(q.text), strip(correctDisplay), strip(studentDisplay), isCorrect];
      });
      const cols = [{header:'Câu', width:6},{header:'Nội dung câu hỏi', width:50},{header:'Đáp án đúng', width:22},{header:'Học viên trả lời', width:22},{header:'Kết quả', width:10}];
      downloadXLSX(`CHITIET_${r.studentName}_${r.quizTitle}.xlsx`, 'Chi tiết', cols, rows, `${r.studentName} — ${r.quizTitle} (${r.score}/${r.total}, Band ${r.band})`);
  };"""

c = c[:i] + new_block + c[j:]
io.open(p, "w", encoding="utf-8").write(c)
print("[OK] exports -> xlsx")
