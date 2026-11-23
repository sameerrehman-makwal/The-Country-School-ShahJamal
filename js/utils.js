/**
 * Utility functions for The Country School ShahJamal Attendance System
 */

/**
 * Returns today's date formatted as YYYY-MM-DD in local time
 * Avoids UTC timezone conversion shifts.
 */
export function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats a YYYY-MM-DD date string into a friendly readable format
 * e.g. "Mon, 23 Nov 2026"
 */
export function formatReadableDate(dateString) {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

/**
 * Sanitizes phone numbers for WhatsApp API links.
 * Normalizes local Pakistani mobile numbers (e.g. 03001234567 -> 923001234567)
 * and strips non-numeric characters.
 */
export function sanitizePhoneForWhatsApp(phone) {
  if (!phone) return null;
  let cleaned = String(phone).replace(/\D/g, ''); // strip spaces, +, -, etc.
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('0')) {
    // Pakistani format: replace leading 0 with 92
    cleaned = '92' + cleaned.substring(1);
  }
  // International format check: length should typically be 10-15 digits
  if (cleaned.length < 10) return null;
  return cleaned;
}

/**
 * Generates a pre-filled WhatsApp click-to-chat URL for parent notification.
 */
export function createWhatsAppLink(parentPhone, studentName, rollNo, status, dateStr) {
  const cleanPhone = sanitizePhoneForWhatsApp(parentPhone);
  if (!cleanPhone) return null;

  const statusMap = {
    'A': 'ABSENT',
    'L': 'LATE',
    'P': 'PRESENT',
    'E': 'EXCUSED'
  };
  const statusWord = statusMap[status] || status;
  const friendlyDate = formatReadableDate(dateStr);

  const message = `*The Country School ShahJamal*\n\n` +
    `Dear Parent/Guardian,\n` +
    `This is to inform you that your child *${studentName}* (Roll No: *${rollNo}*) was marked *${statusWord}* today (${friendlyDate}).\n\n` +
    `If you have any questions or if this was in error, please contact the school office.\n` +
    `Thank you.`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

/**
 * Generates a WhatsApp click-to-chat URL for low attendance warning (<75%).
 */
export function createLowAttendanceWhatsAppLink(parentPhone, studentName, rollNo, percentage, totalDays, presentDays) {
  const cleanPhone = sanitizePhoneForWhatsApp(parentPhone);
  if (!cleanPhone) return null;

  const message = `*The Country School ShahJamal - Attendance Alert*\n\n` +
    `Dear Parent/Guardian,\n` +
    `This is an important academic update for your child *${studentName}* (Roll No: *${rollNo}*).\n\n` +
    `Current Attendance: *${percentage}%* (${presentDays}/${totalDays} days).\n` +
    `The minimum mandatory attendance is *75%*. Falling below this threshold may affect examination eligibility.\n\n` +
    `Please visit or contact the school office to discuss this matter promptly.\n` +
    `Thank you.`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

/**
 * Modern floating Toast notification system
 */
export function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `pointer-events-auto flex items-center gap-3 p-4 rounded-xl shadow-lg border text-sm font-medium transition-all duration-300 transform translate-x-12 opacity-0`;

  let colors = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    error: 'bg-rose-50 border-rose-200 text-rose-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    info: 'bg-indigo-50 border-indigo-200 text-indigo-800'
  };

  let icons = {
    success: `<svg class="w-5 h-5 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`,
    error: `<svg class="w-5 h-5 text-rose-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`,
    warning: `<svg class="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`,
    info: `<svg class="w-5 h-5 text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
  };

  toast.className += ` ${colors[type] || colors.info}`;
  toast.innerHTML = `
    ${icons[type] || icons.info}
    <div class="flex-1">${message}</div>
    <button class="text-gray-400 hover:text-gray-600 focus:outline-none" onclick="this.parentElement.remove()">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>
  `;

  container.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => {
    toast.classList.remove('translate-x-12', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-x-12', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Robust CSV parser that correctly handles quoted strings, commas within quotes,
 * and different line endings (\r\n or \n).
 * Expected headers: RollNo, Name, FatherName, ParentPhone, Gender
 */
export function parseStudentsCSV(csvText) {
  if (!csvText || !csvText.trim()) return [];

  const lines = csvText.trim().split(/\r\n|\n/);
  if (lines.length < 2) return [];

  // Parse header
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map(h => h.trim().toLowerCase());

  // Find column indices
  const rollIdx = headers.findIndex(h => h.includes('roll'));
  const nameIdx = headers.findIndex(h => h.includes('name') && !h.includes('father'));
  const fatherIdx = headers.findIndex(h => h.includes('father'));
  const phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('mobile') || h.includes('whatsapp') || h.includes('contact'));
  const genderIdx = headers.findIndex(h => h.includes('gender') || h.includes('sex'));

  if (rollIdx === -1 || nameIdx === -1) {
    throw new Error('CSV must contain at least "RollNo" and "Name" columns.');
  }

  const students = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const rollNo = values[rollIdx] ? values[rollIdx].trim() : '';
    const name = values[nameIdx] ? values[nameIdx].trim() : '';
    const fatherName = fatherIdx !== -1 && values[fatherIdx] ? values[fatherIdx].trim() : '';
    const parentPhone = phoneIdx !== -1 && values[phoneIdx] ? values[phoneIdx].trim() : '';
    const gender = genderIdx !== -1 && values[genderIdx] ? values[genderIdx].trim() : 'Unspecified';

    if (rollNo && name) {
      students.push({
        rollNo,
        name,
        fatherName,
        parentPhone,
        gender
      });
    }
  }

  return students;
}

/**
 * Splits a single CSV line accounting for quotes
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      if (inQuotes && line[i + 1] === char) {
        current += char;
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Exports data to CSV file with UTF-8 BOM for proper Excel compatibility.
 */
export function downloadCSV(filename, headers, rows) {
  const escapeCell = (cell) => {
    if (cell === null || cell === undefined) return '""';
    const str = String(cell).replace(/"/g, '""');
    return `"${str}"`;
  };

  const headerLine = headers.map(escapeCell).join(',');
  const rowLines = rows.map(row => row.map(escapeCell).join(',')).join('\r\n');
  const csvContent = '\uFEFF' + headerLine + '\r\n' + rowLines;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Calculates academic letter grade from percentage
 * Based on Pakistani Secondary/Higher Board standard grading formula:
 * 90%+ : A+ (Outstanding)
 * 80%-89%: A (Excellent)
 * 70%-79%: B (Very Good)
 * 60%-69%: C (Good)
 * 50%-59%: D (Pass / Fair)
 * Below 50%: F (Fail)
 */
export function calculateGrade(percentage) {
  const p = Number(percentage);
  if (isNaN(p) || p < 0) return 'F';
  if (p >= 90) return 'A+';
  if (p >= 80) return 'A';
  if (p >= 70) return 'B';
  if (p >= 60) return 'C';
  if (p >= 50) return 'D';
  return 'F';
}

/**
 * Normalizes user login ID.
 * If user inputs a Student or Parent ID (e.g. "1001" or "P-1001"),
 * silently converts to a valid email: "1001@school.local" for Firebase Auth.
 */
export function normalizeLoginIdentifier(idStr) {
  if (!idStr) return '';
  const trimmed = idStr.trim().toLowerCase();
  if (trimmed.includes('@')) {
    return trimmed;
  }
  // Sanitize username characters and append default school domain
  const cleanUsername = trimmed.replace(/[^a-z0-9_-]/g, '');
  return `${cleanUsername}@school.local`;
}

/**
 * Computes report card totals, percentages, and overall result status
 */
export function computeReportCardTotals(subjects) {
  let totalMax = 0;
  let totalObtained = 0;
  let hasFailedSubject = false;

  (subjects || []).forEach(sub => {
    const max = Number(sub.maxMarks) || 0;
    const obt = Number(sub.obtainedMarks) || 0;
    const pass = Number(sub.passMarks) || (max * 0.33); // 33% standard passing threshold

    totalMax += max;
    totalObtained += obt;

    if (obt < pass) {
      hasFailedSubject = true;
    }
  });

  const percentage = totalMax > 0 ? Number(((totalObtained / totalMax) * 100).toFixed(1)) : 0;
  const overallGrade = calculateGrade(percentage);
  const overallResult = (hasFailedSubject || percentage < 50) ? 'FAIL' : 'PASS';

  return {
    totalMaxMarks: totalMax,
    totalObtainedMarks: totalObtained,
    percentage,
    overallGrade,
    overallResult
  };
}
