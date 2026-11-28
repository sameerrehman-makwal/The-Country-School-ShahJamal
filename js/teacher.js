/**
 * Teacher Portal & Fast Roll-Call Management
 * The Country School ShahJamal Attendance System
 * 
 * Optimized for mobile touchscreens and zero-cost Firestore reads
 */

import { db } from './firebase-config.js?v=1.0.2';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  query, 
  where, 
  orderBy,
  serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { 
  getTodayDateString, 
  formatReadableDate, 
  createWhatsAppLink, 
  buildAbsenteeWhatsAppUrl,
  calculateGrade, 
  computeReportCardTotals, 
  showToast,
  escapeHTML 
} from './utils.js';
import { writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let teacherUser = null;
let assignedClasses = [];
let currentSelectedClass = null;
let currentClassStudents = [];
let currentAttendanceState = {}; // { [studentId]: { status: 'P'|'A'|'L'|'E', remarks: '' } }
let isReadOnlyMode = false;

// In-Memory Caches for Quota Optimization (Firestore Spark tier preservation)
let teacherClassStudentsCache = {}; // classId -> array of active student objects
let teacherClassSubjectsCache = {}; // classId -> array of subjects

// Marks Entry State
let teacherExamTerms = [];
let currentMarksTerm = null;
let currentMarksClass = null;
let currentMarksStudents = [];
let currentClassSubjects = [];
let currentMarksState = {}; // studentId -> { subjects: [{ name, maxMarks, passMarks, obtainedMarks, grade }], remarks: '' }
let isMarksLocked = false;

/**
 * Initialize Teacher View
 */
export async function initTeacherPortal(user) {
  teacherUser = user;
  
  // Set up DOM elements & event listeners
  const classSelect = document.getElementById('teacher-class-select');
  const dateInput = document.getElementById('teacher-date-input');
  const btnMarkAllPresent = document.getElementById('btn-mark-all-present');
  const btnSaveAttendance = document.getElementById('btn-save-attendance');

  if (classSelect) {
    classSelect.addEventListener('change', handleClassChange);
  }

  if (dateInput) {
    dateInput.value = getTodayDateString();
    dateInput.max = getTodayDateString(); // Cannot select future dates
    dateInput.addEventListener('change', handleDateChange);
  }

  if (btnMarkAllPresent) {
    btnMarkAllPresent.addEventListener('click', markAllPresent);
  }

  if (btnSaveAttendance) {
    btnSaveAttendance.addEventListener('click', saveAttendance);
  }

  // Set up Marks Entry controls
  setupTeacherSubtabs();

  const marksTermSelect = document.getElementById('teacher-marks-term-select');
  const marksClassSelect = document.getElementById('teacher-marks-class-select');
  const btnSaveMarks = document.getElementById('btn-save-marks');

  if (marksTermSelect) {
    marksTermSelect.addEventListener('change', handleMarksTermChange);
  }
  if (marksClassSelect) {
    marksClassSelect.addEventListener('change', handleMarksClassChange);
  }
  if (btnSaveMarks) {
    btnSaveMarks.addEventListener('click', saveTeacherMarks);
  }

  await loadAssignedClasses();
}

/**
 * Switcher between Daily Attendance Roll Call and Exam Marks Entry
 */
function setupTeacherSubtabs() {
  const btnTabAttendance = document.getElementById('btn-teacher-tab-attendance');
  const btnTabMarks = document.getElementById('btn-teacher-tab-marks');
  const sectionAttendance = document.getElementById('teacher-section-attendance');
  const sectionMarks = document.getElementById('teacher-section-marks');

  if (btnTabAttendance && btnTabMarks && sectionAttendance && sectionMarks) {
    btnTabAttendance.addEventListener('click', () => {
      btnTabAttendance.className = 'px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 text-white shadow-sm transition';
      btnTabMarks.className = 'px-4 py-2 text-xs font-bold rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition';
      sectionAttendance.classList.remove('hidden');
      sectionMarks.classList.add('hidden');
    });

    btnTabMarks.addEventListener('click', async () => {
      btnTabMarks.className = 'px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 text-white shadow-sm transition';
      btnTabAttendance.className = 'px-4 py-2 text-xs font-bold rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition';
      sectionAttendance.classList.add('hidden');
      sectionMarks.classList.remove('hidden');
      await initTeacherMarksSection();
    });
  }
}

/**
 * Initialize Teacher Marks Entry View
 */
async function initTeacherMarksSection() {
  const marksTermSelect = document.getElementById('teacher-marks-term-select');
  const marksClassSelect = document.getElementById('teacher-marks-class-select');

  try {
    // 1. Load active terms (reuse in-memory cache if already loaded to avoid redundant reads)
    if (teacherExamTerms.length === 0) {
      const snap = await getDocs(collection(db, 'terms'));
      teacherExamTerms = [];
      snap.forEach(d => teacherExamTerms.push({ id: d.id, ...d.data() }));
    }

    if (marksTermSelect) {
      if (teacherExamTerms.length === 0) {
        marksTermSelect.innerHTML = `<option value="">No exam terms created yet</option>`;
      } else {
        marksTermSelect.innerHTML = teacherExamTerms.map(t => `
          <option value="${escapeHTML(t.id)}">${escapeHTML(t.name)} (${t.status === 'published' ? '🔒 Published' : '📝 Draft'})</option>
        `).join('');
        currentMarksTerm = teacherExamTerms[0];
      }
    }

    // 2. Populate assigned classes
    if (marksClassSelect && assignedClasses.length > 0) {
      marksClassSelect.innerHTML = assignedClasses.map(c => `
        <option value="${escapeHTML(c.id)}">${escapeHTML(c.name || `Grade ${c.grade}-${c.section}`)}</option>
      `).join('');
      currentMarksClass = assignedClasses[0];
    }

    if (currentMarksTerm && currentMarksClass) {
      await loadTeacherMarksSheet();
    }
  } catch (error) {
    console.error('Error loading marks section:', error);
    showToast('Failed to load exam terms: ' + error.message, 'error');
  }
}

async function handleMarksTermChange(e) {
  currentMarksTerm = teacherExamTerms.find(t => t.id === e.target.value);
  await loadTeacherMarksSheet();
}

async function handleMarksClassChange(e) {
  currentMarksClass = assignedClasses.find(c => c.id === e.target.value);
  await loadTeacherMarksSheet();
}

/**
 * Loads subjects, students, and existing marks for this class & term
 */
async function loadTeacherMarksSheet() {
  if (!currentMarksTerm || !currentMarksClass) return;

  const container = document.getElementById('teacher-marks-table-container');
  const lockBanner = document.getElementById('teacher-marks-lock-banner');
  const btnSave = document.getElementById('btn-save-marks');

  isMarksLocked = (currentMarksTerm.status === 'published');

  if (lockBanner) {
    if (isMarksLocked) {
      lockBanner.classList.remove('hidden');
      lockBanner.innerHTML = `
        <div class="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs font-semibold">
          <svg class="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
          <span>Marks Locked: This term has been officially published by School Administration and is in read-only mode.</span>
        </div>
      `;
      if (btnSave) btnSave.disabled = true;
    } else {
      lockBanner.classList.add('hidden');
      if (btnSave) btnSave.disabled = false;
    }
  }

  if (container) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-500">
        <svg class="animate-spin h-6 w-6 text-indigo-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        Loading students and marks sheet...
      </div>
    `;
  }

  try {
    // 1. Fetch class subjects (or default standard template, check in-memory cache first)
    if (teacherClassSubjectsCache[currentMarksClass.id]) {
      currentClassSubjects = teacherClassSubjectsCache[currentMarksClass.id];
    } else {
      const subSnap = await getDoc(doc(db, 'classSubjects', currentMarksClass.id));
      if (subSnap.exists() && subSnap.data().subjects && subSnap.data().subjects.length > 0) {
        currentClassSubjects = subSnap.data().subjects;
      } else {
        currentClassSubjects = [
          { name: 'English', maxMarks: 100, passMarks: 33 },
          { name: 'Mathematics', maxMarks: 100, passMarks: 33 },
          { name: 'Science', maxMarks: 100, passMarks: 33 },
          { name: 'Urdu', maxMarks: 100, passMarks: 33 },
          { name: 'Islamiat', maxMarks: 50, passMarks: 17 }
        ];
      }
      teacherClassSubjectsCache[currentMarksClass.id] = currentClassSubjects;
    }

    // 2. Fetch students for class (reuse in-memory cache if attendance or marks already fetched this class)
    if (teacherClassStudentsCache[currentMarksClass.id]) {
      currentMarksStudents = [...teacherClassStudentsCache[currentMarksClass.id]];
    } else {
      const qStudents = query(
        collection(db, 'students'),
        where('classId', '==', currentMarksClass.id),
        where('status', '==', 'active')
      );
      const snapStudents = await getDocs(qStudents);
      currentMarksStudents = [];
      snapStudents.forEach(d => currentMarksStudents.push({ id: d.id, ...d.data() }));

      currentMarksStudents.sort((a, b) => {
        const numA = parseInt(a.rollNo, 10);
        const numB = parseInt(b.rollNo, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a.rollNo).localeCompare(String(b.rollNo));
      });
      teacherClassStudentsCache[currentMarksClass.id] = [...currentMarksStudents];
    }

    // 3. Fetch existing results for this class and term
    const qResults = query(
      collection(db, 'results'),
      where('classId', '==', currentMarksClass.id),
      where('termId', '==', currentMarksTerm.id)
    );
    const snapResults = await getDocs(qResults);
    const existingResultsMap = {};
    snapResults.forEach(d => {
      const res = d.data();
      existingResultsMap[res.studentId] = res;
    });

    // 4. Initialize state
    currentMarksState = {};
    currentMarksStudents.forEach(student => {
      const existing = existingResultsMap[student.id];
      if (existing && existing.subjects) {
        // Map existing subjects
        const subs = currentClassSubjects.map(templateSub => {
          const found = existing.subjects.find(s => s.name === templateSub.name);
          return {
            name: templateSub.name,
            maxMarks: templateSub.maxMarks,
            passMarks: templateSub.passMarks,
            obtainedMarks: found ? found.obtainedMarks : 0,
            grade: found ? found.grade : 'F'
          };
        });
        currentMarksState[student.id] = {
          subjects: subs,
          remarks: existing.remarks || ''
        };
      } else {
        const subs = currentClassSubjects.map(templateSub => ({
          name: templateSub.name,
          maxMarks: templateSub.maxMarks,
          passMarks: templateSub.passMarks,
          obtainedMarks: 0,
          grade: 'F'
        }));
        currentMarksState[student.id] = {
          subjects: subs,
          remarks: ''
        };
      }
    });

    renderTeacherMarksGrid();
  } catch (error) {
    console.error('Error loading marks sheet:', error);
    showToast('Failed to load marks sheet: ' + error.message, 'error');
  }
}

/**
 * Renders the tabular marks sheet
 */
function renderTeacherMarksGrid() {
  const container = document.getElementById('teacher-marks-table-container');
  if (!container) return;

  if (currentMarksStudents.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
        No active students found in this section.
      </div>
    `;
    return;
  }

  let html = `
    <div class="overflow-x-auto bg-white rounded-2xl border border-slate-200 shadow-sm">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
          <tr>
            <th class="px-3 py-3 border-r border-slate-200 text-center w-12 sticky left-0 bg-slate-50">Roll</th>
            <th class="px-4 py-3 border-r border-slate-200 min-w-[140px] sticky left-12 bg-slate-50">Student Name</th>
            ${currentClassSubjects.map(s => `
              <th class="px-3 py-3 border-r border-slate-100 text-center min-w-[90px]">
                <div>${escapeHTML(s.name)}</div>
                <div class="text-[9px] text-slate-400 font-normal">Max: ${Number(s.maxMarks) || 0}</div>
              </th>
            `).join('')}
            <th class="px-3 py-3 border-r border-slate-200 text-center bg-indigo-50/50 text-indigo-900 font-bold min-w-[70px]">Total</th>
            <th class="px-3 py-3 border-r border-slate-200 text-center bg-indigo-50/50 text-indigo-900 font-bold min-w-[60px]">%</th>
            <th class="px-3 py-3 border-r border-slate-200 text-center bg-indigo-50/50 text-indigo-900 font-bold min-w-[60px]">Grade</th>
            <th class="px-4 py-3 min-w-[180px]">Teacher Remarks</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
  `;

  currentMarksStudents.forEach(student => {
    const studentState = currentMarksState[student.id];
    const totals = computeReportCardTotals(studentState.subjects);

    html += `
      <tr class="hover:bg-slate-50/50 transition" id="marks-row-${escapeHTML(student.id)}">
        <td class="px-3 py-2 text-center font-bold text-slate-700 border-r border-slate-200 sticky left-0 bg-white">${escapeHTML(student.rollNo)}</td>
        <td class="px-4 py-2 font-bold text-slate-800 border-r border-slate-200 sticky left-12 bg-white truncate max-w-[140px]">${escapeHTML(student.name)}</td>
        ${studentState.subjects.map((sub, sIdx) => `
          <td class="px-2 py-2 border-r border-slate-100 text-center">
            <input type="number" 
                   min="0" 
                   max="${Number(sub.maxMarks) || 100}" 
                   value="${Number(sub.obtainedMarks) || 0}" 
                   ${isMarksLocked ? 'disabled' : ''}
                   onchange="window.updateTeacherMark('${escapeHTML(student.id)}', ${sIdx}, this.value)"
                   class="w-16 px-2 py-1 text-center font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-100 outline-none">
          </td>
        `).join('')}
        <td class="px-3 py-2 text-center font-extrabold text-slate-900 border-r border-slate-200 bg-indigo-50/20" id="total-${escapeHTML(student.id)}">
          ${totals.totalObtainedMarks} / ${totals.totalMaxMarks}
        </td>
        <td class="px-3 py-2 text-center font-bold text-indigo-700 border-r border-slate-200 bg-indigo-50/20" id="percent-${escapeHTML(student.id)}">
          ${totals.percentage}%
        </td>
        <td class="px-3 py-2 text-center font-black border-r border-slate-200 bg-indigo-50/20" id="grade-${escapeHTML(student.id)}">
          <span class="px-2 py-0.5 rounded-full text-[10px] ${totals.overallResult === 'PASS' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
            ${escapeHTML(totals.overallGrade)}
          </span>
        </td>
        <td class="px-3 py-2">
          <input type="text" 
                 value="${escapeHTML(studentState.remarks || '')}" 
                 placeholder="e.g. Great progress"
                 ${isMarksLocked ? 'disabled' : ''}
                 onchange="window.updateTeacherRemarks('${escapeHTML(student.id)}', this.value)"
                 class="w-full px-2.5 py-1 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-100 outline-none">
        </td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;
}

window.updateTeacherMark = function(studentId, subjectIdx, value) {
  if (isMarksLocked) return;

  const numVal = Math.max(0, Number(value) || 0);
  const studentState = currentMarksState[studentId];
  if (!studentState || !studentState.subjects[subjectIdx]) return;

  const sub = studentState.subjects[subjectIdx];
  sub.obtainedMarks = Math.min(numVal, sub.maxMarks); // Bound to maxMarks
  sub.grade = calculateGrade((sub.obtainedMarks / sub.maxMarks) * 100);

  // Recalculate Totals
  const totals = computeReportCardTotals(studentState.subjects);

  const elTotal = document.getElementById(`total-${studentId}`);
  const elPercent = document.getElementById(`percent-${studentId}`);
  const elGrade = document.getElementById(`grade-${studentId}`);

  if (elTotal) elTotal.textContent = `${totals.totalObtainedMarks} / ${totals.totalMaxMarks}`;
  if (elPercent) elPercent.textContent = `${totals.percentage}%`;
  if (elGrade) {
    elGrade.innerHTML = `
      <span class="px-2 py-0.5 rounded-full text-[10px] ${totals.overallResult === 'PASS' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
        ${totals.overallGrade}
      </span>
    `;
  }
};

window.updateTeacherRemarks = function(studentId, value) {
  if (isMarksLocked) return;
  if (currentMarksState[studentId]) {
    currentMarksState[studentId].remarks = value.trim();
  }
};

/**
 * Saves all entered marks into results/{studentId}_{termId}
 */
async function saveTeacherMarks() {
  if (!currentMarksTerm || !currentMarksClass) return;

  if (isMarksLocked) {
    showToast('Cannot save marks: Term is already published.', 'error');
    return;
  }

  const btnSave = document.getElementById('btn-save-marks');
  const originalHtml = btnSave ? btnSave.innerHTML : 'Save Marks';

  try {
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.innerHTML = `
        <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        Saving Examination Results...
      `;
    }

    const batch = writeBatch(db);

    currentMarksStudents.forEach(student => {
      const state = currentMarksState[student.id];
      const totals = computeReportCardTotals(state.subjects);
      const docId = `${student.id}_${currentMarksTerm.id}`;
      const docRef = doc(db, 'results', docId);

      batch.set(docRef, {
        studentId: student.id,
        studentName: student.name,
        rollNo: student.rollNo,
        classId: currentMarksClass.id,
        className: currentMarksClass.name || `Grade ${currentMarksClass.grade}-${currentMarksClass.section}`,
        termId: currentMarksTerm.id,
        termName: currentMarksTerm.name,
        academicYear: currentMarksTerm.academicYear || '2026-2027',
        status: currentMarksTerm.status, // "draft"
        subjects: state.subjects,
        totalMaxMarks: totals.totalMaxMarks,
        totalObtainedMarks: totals.totalObtainedMarks,
        percentage: totals.percentage,
        overallGrade: totals.overallGrade,
        overallResult: totals.overallResult,
        remarks: state.remarks || '',
        markedBy: teacherUser.uid,
        markedByName: teacherUser.name || teacherUser.email,
        updatedAt: serverTimestamp()
      }, { merge: true });
    });

    await batch.commit();
    showToast(`Examination marks saved successfully for ${currentMarksClass.name}!`, 'success');
  } catch (error) {
    console.error('Error saving marks:', error);
    showToast('Failed to save marks: ' + error.message, 'error');
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML = originalHtml;
    }
  }
}

/**
 * Loads metadata for classes assigned to this teacher
 */
async function loadAssignedClasses(forceRefresh = false) {
  const classSelect = document.getElementById('teacher-class-select');
  const emptyState = document.getElementById('teacher-no-classes');
  const mainRollCall = document.getElementById('teacher-section-attendance');

  const classIds = teacherUser.assignedClassIds || [];

  if (classIds.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    if (mainRollCall) mainRollCall.classList.add('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  if (mainRollCall) mainRollCall.classList.remove('hidden');

  if (!forceRefresh && assignedClasses.length > 0) {
    if (classSelect) {
      classSelect.innerHTML = assignedClasses.map(c => 
        `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name || `Grade ${c.grade} - Section ${c.section}`)}</option>`
      ).join('');

      if (assignedClasses.length > 0 && !currentSelectedClass) {
        currentSelectedClass = assignedClasses[0];
        await loadClassAttendance();
      }
    }
    return;
  }

  try {
    // Read class docs for assigned IDs
    assignedClasses = [];
    for (const cId of classIds) {
      const snap = await getDoc(doc(db, 'classes', cId));
      if (snap.exists()) {
        assignedClasses.push({ id: snap.id, ...snap.data() });
      }
    }

    // Populate select element
    if (classSelect) {
      classSelect.innerHTML = assignedClasses.map(c => 
        `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name || `Grade ${c.grade} - Section ${c.section}`)}</option>`
      ).join('');

      if (assignedClasses.length > 0) {
        currentSelectedClass = assignedClasses[0];
        await loadClassAttendance();
      }
    }
  } catch (error) {
    console.error('Error loading teacher classes:', error);
    showToast('Failed to load assigned classes.', 'error');
  }
}

/**
 * Handle changing active class
 */
async function handleClassChange(e) {
  const selectedId = e.target.value;
  currentSelectedClass = assignedClasses.find(c => c.id === selectedId);
  await loadClassAttendance();
}

/**
 * Handle date picker change
 */
async function handleDateChange() {
  await loadClassAttendance();
}

/**
 * Loads students and existing attendance document for the selected class and date
 */
async function loadClassAttendance() {
  if (!currentSelectedClass) return;

  const dateInput = document.getElementById('teacher-date-input');
  const selectedDate = dateInput ? dateInput.value : getTodayDateString();
  const today = getTodayDateString();

  // Check anti-tampering lock
  isReadOnlyMode = (selectedDate !== today);
  updateLockBanner(isReadOnlyMode, selectedDate);

  const container = document.getElementById('teacher-student-list');
  if (container) {
    container.innerHTML = `
      <div class="p-8 text-center text-gray-500">
        <svg class="animate-spin h-6 w-6 text-indigo-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Loading students...
      </div>
    `;
  }

  try {
    // 1. Fetch Students strictly for this class (check in-memory cache first to save quota)
    if (teacherClassStudentsCache[currentSelectedClass.id]) {
      currentClassStudents = [...teacherClassStudentsCache[currentSelectedClass.id]];
    } else {
      const studentsRef = collection(db, 'students');
      const q = query(
        studentsRef, 
        where('classId', '==', currentSelectedClass.id),
        where('status', '==', 'active')
      );
      const studentsSnap = await getDocs(q);

      currentClassStudents = [];
      studentsSnap.forEach(docSnap => {
        currentClassStudents.push({ id: docSnap.id, ...docSnap.data() });
      });

      // Sort in memory by Roll Number numerically/alphabetically
      currentClassStudents.sort((a, b) => {
        const numA = parseInt(a.rollNo, 10);
        const numB = parseInt(b.rollNo, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a.rollNo).localeCompare(String(b.rollNo));
      });

      teacherClassStudentsCache[currentSelectedClass.id] = [...currentClassStudents];
    }

    // 2. Fetch Attendance document: attendance/{classId}_{date} (1 single read!)
    const attendanceDocId = `${currentSelectedClass.id}_${selectedDate}`;
    const attendanceSnap = await getDoc(doc(db, 'attendance', attendanceDocId));

    currentAttendanceState = {};

    if (attendanceSnap.exists()) {
      const data = attendanceSnap.data();
      const records = data.records || {};
      currentClassStudents.forEach(student => {
        if (records[student.id]) {
          currentAttendanceState[student.id] = {
            status: records[student.id].status || 'P',
            remarks: records[student.id].remarks || ''
          };
        } else {
          currentAttendanceState[student.id] = { status: 'P', remarks: '' };
        }
      });
    } else {
      // Default initial state: all students set to Present ('P') for quick submission
      currentClassStudents.forEach(student => {
        currentAttendanceState[student.id] = { status: 'P', remarks: '' };
      });
    }

    renderStudentRollCall(selectedDate);
    updateSummaryPills();
  } catch (error) {
    console.error('Error loading attendance:', error);
    showToast('Failed to load class attendance: ' + error.message, 'error');
  }
}

/**
 * Updates the locked/editable banner
 */
function updateLockBanner(isLocked, dateStr) {
  const banner = document.getElementById('teacher-lock-banner');
  const btnSave = document.getElementById('btn-save-attendance');
  const btnMarkAll = document.getElementById('btn-mark-all-present');

  if (banner) {
    if (isLocked) {
      banner.classList.remove('hidden');
      banner.innerHTML = `
        <div class="flex items-center gap-2">
          <svg class="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
          <div>
            <span class="font-bold">Past Attendance Locked (${formatReadableDate(dateStr)}):</span> 
            Only Administrators can modify attendance for past dates. This record is in read-only view.
          </div>
        </div>
      `;
      if (btnSave) btnSave.disabled = true;
      if (btnMarkAll) btnMarkAll.disabled = true;
    } else {
      banner.classList.add('hidden');
      if (btnSave) btnSave.disabled = false;
      if (btnMarkAll) btnMarkAll.disabled = false;
    }
  }
}

/**
 * Renders the responsive roll-call list
 */
function renderStudentRollCall(selectedDate) {
  const container = document.getElementById('teacher-student-list');
  if (!container) return;

  if (currentClassStudents.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-gray-400 bg-white rounded-2xl border border-gray-100">
        <svg class="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
        <p class="font-medium text-gray-600">No active students found in this class.</p>
        <p class="text-xs text-gray-400 mt-1">Ask the Administrator to add or import students for this section.</p>
      </div>
    `;
    return;
  }

  let html = `
    <div class="space-y-3">
  `;

  currentClassStudents.forEach(student => {
    const record = currentAttendanceState[student.id] || { status: 'P', remarks: '' };
    const currentStatus = record.status;
    const showWhatsApp = (currentStatus === 'A' && Boolean(student.parentPhone));

    html += `
      <div class="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:border-gray-200 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4" id="student-row-${escapeHTML(student.id)}">
        <!-- Student Info -->
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center font-bold text-gray-700 text-sm flex-shrink-0">
            ${escapeHTML(student.rollNo)}
          </div>
          <div>
            <div class="font-bold text-gray-800 text-base leading-tight">${escapeHTML(student.name)}</div>
            <div class="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
              <span>S/O, D/O: ${student.fatherName ? escapeHTML(student.fatherName) : '—'}</span>
              ${student.parentPhone ? `<span>• 📞 ${escapeHTML(student.parentPhone)}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Controls: Status Toggle & WhatsApp Action -->
        <div class="flex flex-wrap items-center gap-2 justify-between md:justify-end">
          <!-- WhatsApp Absentee Action Button -->
          <div id="wa-btn-container-${escapeHTML(student.id)}" class="${showWhatsApp ? 'inline-block' : 'hidden'}">
            ${student.parentPhone ? `
              <button type="button" 
                      data-action="whatsapp-absent"
                      data-phone="${escapeHTML(student.parentPhone)}"
                      data-name="${escapeHTML(student.name)}"
                      data-roll="${escapeHTML(student.rollNo)}"
                      data-class="${escapeHTML(currentSelectedClass ? currentSelectedClass.name : '')}"
                      data-date="${escapeHTML(selectedDate)}"
                      title="Send WhatsApp Absence Alert to Parent"
                      class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition active:scale-95">
                <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.288.043.088.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.861.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.203c.044.071.044.418-.1.823z"/>
                </svg>
                <span data-i18n="btn_whatsapp">WhatsApp</span>
              </button>
            ` : `
              <span class="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-lg">No Phone</span>
            `}
          </div>

          <!-- P / A / L / E Segmented Toggle -->
          <div class="inline-flex rounded-xl bg-gray-100 p-1 border border-gray-200">
            <button type="button" 
                    ${isReadOnlyMode ? 'disabled' : ''}
                    onclick="window.toggleAttendance('${escapeHTML(student.id)}', 'P')"
                    class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${currentStatus === 'P' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}">
              P
            </button>
            <button type="button" 
                    ${isReadOnlyMode ? 'disabled' : ''}
                    onclick="window.toggleAttendance('${escapeHTML(student.id)}', 'A')"
                    class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${currentStatus === 'A' ? 'bg-rose-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}">
              A
            </button>
            <button type="button" 
                    ${isReadOnlyMode ? 'disabled' : ''}
                    onclick="window.toggleAttendance('${escapeHTML(student.id)}', 'L')"
                    class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${currentStatus === 'L' ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}">
              L
            </button>
            <button type="button" 
                    ${isReadOnlyMode ? 'disabled' : ''}
                    onclick="window.toggleAttendance('${escapeHTML(student.id)}', 'E')"
                    class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${currentStatus === 'E' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}">
              E
            </button>
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

/**
 * Toggle single student status (Exposed to window for inline onclick)
 */
window.toggleAttendance = function(studentId, newStatus) {
  if (isReadOnlyMode) return;

  if (!currentAttendanceState[studentId]) {
    currentAttendanceState[studentId] = { status: newStatus, remarks: '' };
  } else {
    currentAttendanceState[studentId].status = newStatus;
  }

  const dateInput = document.getElementById('teacher-date-input');
  const selectedDate = dateInput ? dateInput.value : getTodayDateString();
  const student = currentClassStudents.find(s => s.id === studentId);

  // Update button row styles without full re-render for smooth 60fps mobile interaction
  const row = document.getElementById(`student-row-${studentId}`);
  if (row) {
    const buttons = row.querySelectorAll('button');
    const statusMap = { 'P': 0, 'A': 1, 'L': 2, 'E': 3 };
    const colors = {
      'P': 'bg-emerald-600 text-white shadow-sm',
      'A': 'bg-rose-600 text-white shadow-sm',
      'L': 'bg-amber-500 text-white shadow-sm',
      'E': 'bg-blue-600 text-white shadow-sm'
    };

    buttons.forEach((btn, idx) => {
      btn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-gray-600 hover:text-gray-900';
      if (statusMap[newStatus] === idx) {
        btn.className = `px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${colors[newStatus]}`;
      }
    });

    // Update WhatsApp button visibility (Visible when Absent 'A' and parent phone exists)
    const waContainer = document.getElementById(`wa-btn-container-${studentId}`);
    if (waContainer && student) {
      if (newStatus === 'A' && student.parentPhone) {
        waContainer.innerHTML = `
          <button type="button" 
                  data-action="whatsapp-absent"
                  data-phone="${escapeHTML(student.parentPhone)}"
                  data-name="${escapeHTML(student.name)}"
                  data-roll="${escapeHTML(student.rollNo)}"
                  data-class="${escapeHTML(currentSelectedClass ? currentSelectedClass.name : '')}"
                  data-date="${escapeHTML(selectedDate)}"
                  title="Send WhatsApp Absence Alert to Parent"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition active:scale-95">
            <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.288.043.088.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.861.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.203c.044.071.044.418-.1.823z"/>
            </svg>
            <span data-i18n="btn_whatsapp">WhatsApp</span>
          </button>
        `;
        waContainer.classList.remove('hidden');
        waContainer.classList.add('inline-block');
      } else {
        waContainer.classList.add('hidden');
        waContainer.classList.remove('inline-block');
      }
    }
  }

  updateSummaryPills();
};

/**
 * Mark all students present with one click
 */
function markAllPresent() {
  if (isReadOnlyMode) return;
  currentClassStudents.forEach(student => {
    currentAttendanceState[student.id] = { status: 'P', remarks: '' };
  });
  const dateInput = document.getElementById('teacher-date-input');
  renderStudentRollCall(dateInput ? dateInput.value : getTodayDateString());
  updateSummaryPills();
  showToast('All students marked as Present.', 'info');
}

/**
 * Recalculate summary pills (Total, Present, Absent, Late, Excused)
 */
function updateSummaryPills() {
  let present = 0, absent = 0, late = 0, excused = 0;
  const total = currentClassStudents.length;

  currentClassStudents.forEach(s => {
    const st = currentAttendanceState[s.id] ? currentAttendanceState[s.id].status : 'P';
    if (st === 'P') present++;
    else if (st === 'A') absent++;
    else if (st === 'L') late++;
    else if (st === 'E') excused++;
  });

  const elTotal = document.getElementById('teacher-stat-total');
  const elPresent = document.getElementById('teacher-stat-present');
  const elAbsent = document.getElementById('teacher-stat-absent');
  const elLate = document.getElementById('teacher-stat-late');
  const elExcused = document.getElementById('teacher-stat-excused');

  if (elTotal) elTotal.textContent = total;
  if (elPresent) elPresent.textContent = present;
  if (elAbsent) elAbsent.textContent = absent;
  if (elLate) elLate.textContent = late;
  if (elExcused) elExcused.textContent = excused;
}

/**
 * Saves attendance to Firestore: attendance/{classId}_{date}
 * Writes 1 single document containing the full class records map!
 */
async function saveAttendance() {
  if (!currentSelectedClass) {
    showToast('No class selected.', 'warning');
    return;
  }

  const dateInput = document.getElementById('teacher-date-input');
  const selectedDate = dateInput ? dateInput.value : getTodayDateString();
  const today = getTodayDateString();

  if (selectedDate !== today) {
    showToast('Anti-Tampering: Past attendance cannot be modified by teachers.', 'error');
    return;
  }

  const btnSave = document.getElementById('btn-save-attendance');
  const originalHtml = btnSave ? btnSave.innerHTML : 'Save Attendance';

  try {
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.innerHTML = `
        <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg> Saving...`;
    }

    let present = 0, absent = 0, late = 0, excused = 0;
    const recordsMap = {};

    currentClassStudents.forEach(s => {
      const state = currentAttendanceState[s.id] || { status: 'P', remarks: '' };
      recordsMap[s.id] = {
        status: state.status,
        remarks: state.remarks || '',
        updatedAt: new Date().toISOString()
      };

      if (state.status === 'P') present++;
      else if (state.status === 'A') absent++;
      else if (state.status === 'L') late++;
      else if (state.status === 'E') excused++;
    });

    const docId = `${currentSelectedClass.id}_${selectedDate}`;
    const attendanceData = {
      classId: currentSelectedClass.id,
      className: currentSelectedClass.name || `Grade ${currentSelectedClass.grade}-${currentSelectedClass.section}`,
      date: selectedDate,
      academicYear: currentSelectedClass.academicYear || '2026-2027',
      markedBy: teacherUser.uid,
      markedByName: teacherUser.name || teacherUser.email,
      summary: {
        total: currentClassStudents.length,
        present,
        absent,
        late,
        excused
      },
      records: recordsMap,
      updatedAt: serverTimestamp()
    };

    // Save to Firestore (works offline with IndexedDB seamlessly!)
    await setDoc(doc(db, 'attendance', docId), attendanceData, { merge: true });

    showToast(`Attendance saved successfully for ${currentSelectedClass.name}!`, 'success');
  } catch (error) {
    console.error('Error saving attendance:', error);
    showToast('Failed to save attendance: ' + error.message, 'error');
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML = originalHtml;
    }
  }
}

/**
 * Delegated Click Handler for WhatsApp Absentee Alerts in Teacher Roll Call
 */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="whatsapp-absent"]');
  if (!btn) return;
  e.preventDefault();

  const phone = btn.dataset.phone;
  const studentName = btn.dataset.name;
  const rollNo = btn.dataset.roll;
  const className = btn.dataset.class;
  const dateStr = btn.dataset.date;
  const lang = (typeof localStorage !== 'undefined' ? localStorage.getItem('tcs_lang') : 'en') || 'en';

  const url = buildAbsenteeWhatsAppUrl(phone, { studentName, rollNo, className, dateStr, lang });
  if (url) {
    window.open(url, '_blank', 'noopener');
  } else {
    showToast('Invalid parent phone number for WhatsApp.', 'error');
  }
});
