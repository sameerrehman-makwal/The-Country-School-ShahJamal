/**
 * Parent Portal & Examination Report Card Viewer
 * The Country School ShahJamal Attendance & Exam System
 * 
 * Optimized for mobile touchscreens, multi-child switching, and zero-cost Firestore reads
 */

import { db } from './firebase-config.js?v=1.0.2';
import { 
  doc, 
  getDoc, 
  collection, 
  getDocs, 
  query, 
  where 
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { 
  formatReadableDate, 
  calculateGrade, 
  showToast,
  escapeHTML 
} from './utils.js';

let parentUser = null;
let linkedStudentsList = [];
let currentChild = null;
let publishedTerms = [];
let selectedTermId = null;

// In-Memory Caches for Quota Optimization (Firestore Spark tier preservation)
let classNamesCache = {}; // classId -> className string
let parentAttendanceCache = {}; // classId -> array of attendance doc data
let parentReportCardsCache = {}; // `${childId}_${termId}` -> resultData object

/**
 * Initialize Parent Portal
 */
export async function initParentPortal(user) {
  parentUser = user;

  const termSelect = document.getElementById('parent-term-select');
  const btnPrintReport = document.getElementById('btn-print-parent-report');

  if (termSelect) {
    termSelect.addEventListener('change', (e) => {
      selectedTermId = e.target.value;
      loadChildReportCard();
    });
  }

  if (btnPrintReport) {
    btnPrintReport.addEventListener('click', () => {
      window.print();
    });
  }

  await loadLinkedChildren();
}

/**
 * Loads student records for children linked to this parent account
 */
async function loadLinkedChildren(forceRefresh = false) {
  const emptyState = document.getElementById('parent-no-children');
  const mainSection = document.getElementById('parent-main-section');

  const studentIds = parentUser.linkedStudents || [];

  if (studentIds.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    if (mainSection) mainSection.classList.add('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  if (mainSection) mainSection.classList.remove('hidden');

  if (!forceRefresh && linkedStudentsList.length > 0) {
    renderChildSwitcher();
    if (!currentChild) {
      currentChild = linkedStudentsList[0];
      await selectChild(currentChild.id);
    }
    return;
  }

  try {
    linkedStudentsList = [];
    for (const stdId of studentIds) {
      const snap = await getDoc(doc(db, 'students', stdId));
      if (snap.exists()) {
        const studentData = { id: snap.id, ...snap.data() };
        // Fetch class name (check in-memory cache first to avoid duplicate class reads for siblings)
        if (studentData.classId) {
          if (classNamesCache[studentData.classId]) {
            studentData.className = classNamesCache[studentData.classId];
          } else {
            const classSnap = await getDoc(doc(db, 'classes', studentData.classId));
            studentData.className = classSnap.exists() ? (classSnap.data().name || studentData.classId) : studentData.classId;
            classNamesCache[studentData.classId] = studentData.className;
          }
        }
        linkedStudentsList.push(studentData);
      }
    }

    if (linkedStudentsList.length === 0) {
      if (emptyState) emptyState.classList.remove('hidden');
      if (mainSection) mainSection.classList.add('hidden');
      return;
    }

    renderChildSwitcher();
    currentChild = linkedStudentsList[0];
    await selectChild(currentChild.id);
  } catch (error) {
    console.error('Error loading linked students:', error);
    showToast('Failed to load student profiles: ' + error.message, 'error');
  }
}

/**
 * Renders the sibling switcher tabs
 */
function renderChildSwitcher() {
  const switcherContainer = document.getElementById('parent-child-switcher');
  if (!switcherContainer) return;

  if (linkedStudentsList.length <= 1) {
    switcherContainer.innerHTML = '';
    switcherContainer.classList.add('hidden');
    return;
  }

  switcherContainer.classList.remove('hidden');
  switcherContainer.innerHTML = `
    <div class="flex items-center gap-2 overflow-x-auto pb-1">
      <span class="text-xs font-bold text-slate-500 uppercase tracking-wider mr-1">Children:</span>
      ${linkedStudentsList.map((child, idx) => `
        <button onclick="window.switchParentChild('${escapeHTML(child.id)}')"
                id="btn-child-tab-${escapeHTML(child.id)}"
                class="px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${idx === 0 ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'}">
          ${escapeHTML(child.name)} (${escapeHTML(child.rollNo)})
        </button>
      `).join('')}
    </div>
  `;
}

window.switchParentChild = async function(childId) {
  linkedStudentsList.forEach(c => {
    const btn = document.getElementById(`btn-child-tab-${c.id}`);
    if (btn) {
      if (c.id === childId) {
        btn.className = 'px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap bg-indigo-600 text-white shadow-sm';
      } else {
        btn.className = 'px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap bg-white text-slate-700 hover:bg-slate-100 border border-slate-200';
      }
    }
  });

  await selectChild(childId);
};

/**
 * Activates a selected child and loads their attendance + report cards
 */
async function selectChild(childId) {
  currentChild = linkedStudentsList.find(c => c.id === childId);
  if (!currentChild) return;

  // Render Child Header Card
  const elName = document.getElementById('parent-child-name');
  const elRoll = document.getElementById('parent-child-roll');
  const elClass = document.getElementById('parent-child-class');
  const elFather = document.getElementById('parent-child-father');

  if (elName) elName.textContent = currentChild.name;
  if (elRoll) elRoll.textContent = currentChild.rollNo;
  if (elClass) elClass.textContent = currentChild.className || 'Assigned Section';
  if (elFather) elFather.textContent = currentChild.fatherName || '—';

  // Load Child Attendance & Exams
  await loadChildAttendance();
  await loadPublishedTerms();
}

/**
 * Computes child's attendance summary from class attendance documents
 */
async function loadChildAttendance() {
  if (!currentChild || !currentChild.classId) return;

  try {
    // Read attendance documents for this child's class (reuse in-memory cache if already loaded)
    let attendanceDocs = [];
    if (parentAttendanceCache[currentChild.classId]) {
      attendanceDocs = parentAttendanceCache[currentChild.classId];
    } else {
      const q = query(
        collection(db, 'attendance'),
        where('classId', '==', currentChild.classId)
      );
      const snap = await getDocs(q);
      snap.forEach(d => attendanceDocs.push(d.data()));
      parentAttendanceCache[currentChild.classId] = attendanceDocs;
    }

    let totalDays = 0;
    let present = 0;
    let absent = 0;
    let late = 0;
    let excused = 0;

    attendanceDocs.forEach(data => {
      const records = data.records || {};
      const childRecord = records[currentChild.id];
      if (childRecord) {
        totalDays++;
        if (childRecord.status === 'P') present++;
        else if (childRecord.status === 'A') absent++;
        else if (childRecord.status === 'L') late++;
        else if (childRecord.status === 'E') excused++;
      }
    });

    const percent = totalDays > 0 ? Math.round(((present + (late * 0.5)) / totalDays) * 100) : 0;

    const elTotal = document.getElementById('parent-att-total');
    const elPresent = document.getElementById('parent-att-present');
    const elAbsent = document.getElementById('parent-att-absent');
    const elLate = document.getElementById('parent-att-late');
    const elPercent = document.getElementById('parent-att-percent');
    const elWarning = document.getElementById('parent-att-warning');

    if (elTotal) elTotal.textContent = totalDays;
    if (elPresent) elPresent.textContent = present;
    if (elAbsent) elAbsent.textContent = absent;
    if (elLate) elLate.textContent = late;
    if (elPercent) elPercent.textContent = `${percent}%`;

    if (elWarning) {
      if (percent < 75 && totalDays > 0) {
        elWarning.classList.remove('hidden');
        elWarning.innerHTML = `
          <div class="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs font-semibold">
            <svg class="w-4 h-4 text-rose-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            <span>Notice: Attendance is below mandatory 75%. Please contact the class teacher.</span>
          </div>
        `;
      } else {
        elWarning.classList.add('hidden');
      }
    }
  } catch (error) {
    console.error('Error loading child attendance:', error);
  }
}

/**
 * Loads published exam terms for the dropdown
 */
async function loadPublishedTerms() {
  const termSelect = document.getElementById('parent-term-select');
  if (!termSelect) return;

  try {
    // Reuse in-memory cache if already loaded
    if (publishedTerms.length === 0) {
      const q = query(collection(db, 'terms'), where('status', '==', 'published'));
      const snap = await getDocs(q);

      publishedTerms = [];
      snap.forEach(d => publishedTerms.push({ id: d.id, ...d.data() }));
    }

    if (publishedTerms.length === 0) {
      termSelect.innerHTML = `<option value="">No published terms available</option>`;
      renderNoReportCard('No examinations have been published yet.');
      return;
    }

    termSelect.innerHTML = publishedTerms.map(t => 
      `<option value="${escapeHTML(t.id)}">${escapeHTML(t.name)} (${escapeHTML(t.academicYear || '2026-2027')})</option>`
    ).join('');

    selectedTermId = publishedTerms[0].id;
    await loadChildReportCard();
  } catch (error) {
    console.error('Error loading published terms:', error);
  }
}

/**
 * Loads and renders the single result document for the child & term
 * Exactly 1 document read: results/{studentId}_{termId}
 */
async function loadChildReportCard() {
  if (!currentChild || !selectedTermId) return;

  const container = document.getElementById('parent-report-card-container');
  if (!container) return;

  const docId = `${currentChild.id}_${selectedTermId}`;

  // Check in-memory report card cache first
  if (parentReportCardsCache[docId]) {
    const cachedData = parentReportCardsCache[docId];
    if (cachedData === 'NOT_FOUND') {
      renderNoReportCard('Marks for this examination session have not been posted.');
      return;
    }
    if (cachedData.status !== 'published') {
      renderNoReportCard('Results for this term are currently in draft preparation.');
      return;
    }
    renderOfficialReportCard(cachedData);
    return;
  }

  container.innerHTML = `
    <div class="p-8 text-center text-slate-500">
      <svg class="animate-spin h-6 w-6 text-indigo-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
      Loading official examination report card...
    </div>
  `;

  try {
    const snap = await getDoc(doc(db, 'results', docId));

    if (!snap.exists()) {
      parentReportCardsCache[docId] = 'NOT_FOUND';
      renderNoReportCard('Marks for this examination session have not been posted.');
      return;
    }

    const data = snap.data();
    parentReportCardsCache[docId] = data;

    // Security check: Verify published status
    if (data.status !== 'published') {
      renderNoReportCard('Results for this term are currently in draft preparation.');
      return;
    }

    renderOfficialReportCard(data);
  } catch (error) {
    console.error('Error loading result:', error);
    renderNoReportCard('Failed to load report card: ' + error.message);
  }
}

function renderNoReportCard(message) {
  const container = document.getElementById('parent-report-card-container');
  const printBtn = document.getElementById('btn-print-parent-report');
  if (printBtn) printBtn.disabled = true;

  if (container) {
    container.innerHTML = `
      <div class="p-12 text-center text-slate-400 bg-white rounded-3xl border border-slate-200">
        <svg class="w-12 h-12 mx-auto text-slate-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        <p class="font-bold text-slate-700 text-sm">${escapeHTML(message)}</p>
        <p class="text-xs text-slate-400 mt-1">Please check back once the school administration issues the results.</p>
      </div>
    `;
  }
}

/**
 * Renders the formal Report Card in UI and prepares the print layout
 */
function renderOfficialReportCard(resultData) {
  const container = document.getElementById('parent-report-card-container');
  const printBtn = document.getElementById('btn-print-parent-report');
  if (printBtn) printBtn.disabled = false;
  if (!container) return;

  const subjects = resultData.subjects || [];
  const isPassed = resultData.overallResult === 'PASS';

  let html = `
    <div id="official-student-report-card" class="bg-white rounded-3xl border border-slate-200 shadow-md overflow-hidden p-6 sm:p-8">
      
      <!-- Report Header -->
      <div class="border-b-2 border-indigo-600 pb-6 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-2xl bg-indigo-700 text-white flex items-center justify-center font-black text-2xl shadow-md">
            CS
          </div>
          <div>
            <h2 class="text-xl sm:text-2xl font-black text-slate-900 leading-tight">The Country School</h2>
            <p class="text-xs font-bold text-indigo-600 uppercase tracking-widest">ShahJamal Campus • Student Examination Report</p>
            <p class="text-xs text-slate-500 font-medium">${escapeHTML(resultData.termName || 'Term Examination')} (${escapeHTML(resultData.academicYear || '2026-2027')})</p>
          </div>
        </div>
        <div class="px-4 py-2 rounded-2xl ${isPassed ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-rose-50 border border-rose-200 text-rose-800'} text-center font-bold">
          <span class="block text-[10px] uppercase tracking-wider">Result Status</span>
          <span class="text-base font-black">${escapeHTML(resultData.overallResult || 'PASS')}</span>
        </div>
      </div>

      <!-- Student Metadata Strip -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 rounded-2xl mb-6 text-xs">
        <div>
          <span class="text-slate-400 block text-[10px] uppercase font-bold">Student Name</span>
          <span class="font-extrabold text-slate-900 text-sm">${escapeHTML(resultData.studentName)}</span>
        </div>
        <div>
          <span class="text-slate-400 block text-[10px] uppercase font-bold">Roll Number</span>
          <span class="font-extrabold text-slate-900 text-sm">${escapeHTML(resultData.rollNo)}</span>
        </div>
        <div>
          <span class="text-slate-400 block text-[10px] uppercase font-bold">Class / Section</span>
          <span class="font-extrabold text-slate-900 text-sm">${escapeHTML(resultData.className)}</span>
        </div>
        <div>
          <span class="text-slate-400 block text-[10px] uppercase font-bold">Overall Grade</span>
          <span class="font-black text-indigo-700 text-sm">${escapeHTML(resultData.overallGrade)} (${Number(resultData.percentage) || 0}%)</span>
        </div>
      </div>

      <!-- Marks Breakdown Table -->
      <div class="overflow-x-auto rounded-2xl border border-slate-200 mb-6">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
            <tr>
              <th class="px-4 py-3">Subject</th>
              <th class="px-4 py-3 text-center">Max Marks</th>
              <th class="px-4 py-3 text-center">Passing</th>
              <th class="px-4 py-3 text-center">Obtained Marks</th>
              <th class="px-4 py-3 text-center">Grade</th>
              <th class="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${subjects.map(s => {
              const passMarks = s.passMarks || Math.round(s.maxMarks * 0.33);
              const isSubPass = Number(s.obtainedMarks) >= passMarks;
              const subGrade = s.grade || calculateGrade((s.obtainedMarks / s.maxMarks) * 100);

              return `
                <tr class="hover:bg-slate-50/50 transition">
                  <td class="px-4 py-3 font-bold text-slate-800">${escapeHTML(s.name)}</td>
                  <td class="px-4 py-3 text-center text-slate-600">${Number(s.maxMarks) || 0}</td>
                  <td class="px-4 py-3 text-center text-slate-400 font-mono">${Number(passMarks) || 0}</td>
                  <td class="px-4 py-3 text-center font-extrabold text-slate-900 text-sm">${Number(s.obtainedMarks) || 0}</td>
                  <td class="px-4 py-3 text-center font-bold text-indigo-700">${escapeHTML(subGrade)}</td>
                  <td class="px-4 py-3 text-center">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isSubPass ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
                      ${isSubPass ? 'PASS' : 'FAIL'}
                    </span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
          <tfoot class="bg-slate-50 font-extrabold border-t-2 border-slate-200 text-slate-900">
            <tr>
              <td class="px-4 py-3">Grand Total</td>
              <td class="px-4 py-3 text-center">${Number(resultData.totalMaxMarks) || 0}</td>
              <td class="px-4 py-3 text-center">—</td>
              <td class="px-4 py-3 text-center text-base text-indigo-700">${Number(resultData.totalObtainedMarks) || 0}</td>
              <td class="px-4 py-3 text-center text-indigo-700">${escapeHTML(resultData.overallGrade)}</td>
              <td class="px-4 py-3 text-center">${Number(resultData.percentage) || 0}%</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Remarks & Teacher Feedback -->
      <div class="p-4 rounded-2xl bg-indigo-50/50 border border-indigo-100 mb-8">
        <span class="block text-[10px] uppercase font-bold text-indigo-600 mb-1">Teacher's Observations & Remarks:</span>
        <p class="text-xs font-semibold text-slate-800 italic">
          "${escapeHTML(resultData.remarks || 'Diligent effort demonstrated during this examination term. Continuous practice recommended.')}"
        </p>
      </div>

      <!-- Signatures Footer -->
      <div class="pt-8 border-t border-slate-200 grid grid-cols-3 gap-4 text-center text-xs text-slate-500">
        <div>
          <div class="border-b border-slate-300 w-32 mx-auto mb-1 h-6"></div>
          <span class="font-bold">Class Teacher</span>
        </div>
        <div>
          <div class="border-b border-slate-300 w-32 mx-auto mb-1 h-6"></div>
          <span class="font-bold">Controller of Exams</span>
        </div>
        <div>
          <div class="border-b border-slate-300 w-32 mx-auto mb-1 h-6"></div>
          <span class="font-bold">Principal Signature</span>
        </div>
      </div>

    </div>
  `;

  container.innerHTML = html;
}
