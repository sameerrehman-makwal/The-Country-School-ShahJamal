/**
 * Administrator Dashboard & School Management
 * The Country School ShahJamal Attendance System
 * 
 * Optimized for low-cost Firestore operations and bulk data management
 */

import { db, auth } from './firebase-config.js?v=1.0.1';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  writeBatch, 
  query, 
  where, 
  orderBy, 
  serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { 
  getTodayDateString, 
  formatReadableDate, 
  parseStudentsCSV, 
  downloadCSV, 
  createLowAttendanceWhatsAppLink, 
  createWhatsAppLink,
  normalizeLoginIdentifier,
  showToast,
  escapeHTML 
} from './utils.js';

let adminUser = null;
let allSchoolClasses = [];
let parsedCSVStudents = [];
let currentAdminClassStudents = [];
let selectedAdminClassId = null;

// In-Memory Caches for Quota Optimization (Firestore Spark tier preservation)
let classStudentsCache = {}; // classId -> array of active student objects
let cachedTeachersList = null; // array of teacher user objects
let cachedParentsList = null; // array of parent user objects
let classSubjectsCache = {}; // classId -> array of subjects

// Exam & Parent State
let allExamTerms = [];
let selectedConfigClassId = null;
let parentSelectorStudents = [];

/**
 * Initialize Admin Portal
 */
export async function initAdminPortal(user) {
  adminUser = user;
  setupNavigationTabs();
  setupClassManagementListeners();
  setupStudentManagementListeners();
  setupTeacherManagementListeners();
  setupDailyOverviewListeners();
  setupReportListeners();
  setupExamManagementListeners();
  setupParentManagementListeners();

  // Load initial baseline data
  await loadAllClasses();
  await loadDailyOverview();
}

/**
 * Tab Navigation in Admin Dashboard
 */
function setupNavigationTabs() {
  const tabButtons = document.querySelectorAll('.admin-nav-tab');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchAdminTab(targetTab);
    });
  });
}

export function switchAdminTab(tabName) {
  // Update nav buttons
  document.querySelectorAll('.admin-nav-tab').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabName) {
      btn.className = 'admin-nav-tab px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white shadow-sm transition';
    } else {
      btn.className = 'admin-nav-tab px-4 py-2 text-sm font-semibold rounded-xl text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition';
    }
  });

  // Switch tab content containers
  document.querySelectorAll('.admin-tab-content').forEach(container => {
    container.classList.add('hidden');
  });

  const activeContent = document.getElementById(`admin-tab-${tabName}`);
  if (activeContent) {
    activeContent.classList.remove('hidden');
  }

  // Auto-refresh data on tab switch
  if (tabName === 'overview') {
    loadDailyOverview();
  } else if (tabName === 'classes') {
    renderClassesTable();
  } else if (tabName === 'teachers') {
    loadTeachersList();
  } else if (tabName === 'students') {
    refreshStudentClassDropdown();
  } else if (tabName === 'reports') {
    refreshReportClassDropdown();
  } else if (tabName === 'exams') {
    loadExamTermsList();
    loadClassSubjectConfig();
  } else if (tabName === 'parents') {
    loadParentAccountsList();
    loadParentStudentSelector();
  }
}

/* =====================================================================
   1. CLASS MANAGEMENT
   ===================================================================== */

function setupClassManagementListeners() {
  const formAddClass = document.getElementById('form-add-class');
  if (formAddClass) {
    formAddClass.addEventListener('submit', handleAddClass);
  }
}

async function loadAllClasses(forceRefresh = false) {
  if (!forceRefresh && allSchoolClasses.length > 0) {
    renderClassesTable();
    refreshStudentClassDropdown();
    refreshReportClassDropdown();
    return;
  }
  try {
    const snap = await getDocs(collection(db, 'classes'));
    allSchoolClasses = [];
    snap.forEach(d => {
      allSchoolClasses.push({ id: d.id, ...d.data() });
    });

    // Sort classes by Grade, then Section
    allSchoolClasses.sort((a, b) => {
      const gA = parseInt(a.grade, 10) || 0;
      const gB = parseInt(b.grade, 10) || 0;
      if (gA !== gB) return gA - gB;
      return String(a.section).localeCompare(String(b.section));
    });

    renderClassesTable();
    refreshStudentClassDropdown();
    refreshReportClassDropdown();
  } catch (error) {
    console.error('Error loading classes:', error);
    showToast('Failed to load classes.', 'error');
  }
}

function renderClassesTable() {
  const tbody = document.getElementById('table-classes-body');
  if (!tbody) return;

  if (allSchoolClasses.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="px-6 py-8 text-center text-gray-400">
          No classes registered yet. Create your first class above!
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = allSchoolClasses.map(c => `
    <tr class="border-b border-gray-100 hover:bg-gray-50/50 transition">
      <td class="px-6 py-4 font-bold text-gray-900">${escapeHTML(c.name)}</td>
      <td class="px-6 py-4 text-gray-600">Grade ${escapeHTML(c.grade)}</td>
      <td class="px-6 py-4 text-gray-600">Section ${escapeHTML(c.section)}</td>
      <td class="px-6 py-4">
        <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700">
          ${Number(c.studentCount) || 0} Students
        </span>
      </td>
      <td class="px-6 py-4 text-right space-x-2">
        <button onclick="window.deleteClassPrompt('${escapeHTML(c.id)}', this.dataset.name)" 
                data-name="${escapeHTML(c.name)}"
                class="text-rose-600 hover:text-rose-800 text-xs font-semibold p-1 hover:bg-rose-50 rounded-lg transition">
          Delete
        </button>
      </td>
    </tr>
  `).join('');
}

async function handleAddClass(e) {
  e.preventDefault();
  const nameInput = document.getElementById('class-name');
  const gradeInput = document.getElementById('class-grade');
  const sectionInput = document.getElementById('class-section');
  const academicYearInput = document.getElementById('class-academic-year');

  const name = nameInput.value.trim();
  const grade = gradeInput.value.trim();
  const section = sectionInput.value.trim().toUpperCase();
  const academicYear = academicYearInput ? academicYearInput.value.trim() : '2026-2027';

  if (!name || !grade || !section) {
    showToast('Please fill all required class fields.', 'warning');
    return;
  }

  // Consistent ID pattern: class_grade_section (e.g. class_10_a)
  const classId = `class_${grade}_${section.toLowerCase()}`;

  try {
    await setDoc(doc(db, 'classes', classId), {
      name,
      grade,
      section,
      academicYear,
      studentCount: 0,
      createdAt: serverTimestamp()
    }, { merge: true });

    showToast(`Class "${name}" created successfully!`, 'success');
    nameInput.value = '';
    gradeInput.value = '';
    sectionInput.value = '';

    await loadAllClasses(true);
  } catch (error) {
    console.error('Error adding class:', error);
    showToast('Failed to create class: ' + error.message, 'error');
  }
}

window.deleteClassPrompt = async function(classId, className) {
  const targetClass = allSchoolClasses.find(c => c.id === classId);
  const displayName = className || (targetClass ? targetClass.name : 'this class');
  if (!confirm(`Are you sure you want to delete "${displayName}"? Note: Deleting a class does not automatically delete students assigned to it.`)) {
    return;
  }

  try {
    await deleteDoc(doc(db, 'classes', classId));
    delete classStudentsCache[classId];
    delete classSubjectsCache[classId];
    showToast(`Class "${displayName}" deleted.`, 'info');
    await loadAllClasses(true);
  } catch (error) {
    console.error('Error deleting class:', error);
    showToast('Failed to delete class: ' + error.message, 'error');
  }
};

/* =====================================================================
   2. STUDENT MANAGEMENT & BULK CSV IMPORTER
   ===================================================================== */

function setupStudentManagementListeners() {
  const classFilter = document.getElementById('admin-student-class-filter');
  const formAddStudent = document.getElementById('form-add-student');
  const csvFileInput = document.getElementById('csv-file-input');
  const btnConfirmCsvImport = document.getElementById('btn-confirm-csv-import');

  if (classFilter) {
    classFilter.addEventListener('change', async (e) => {
      selectedAdminClassId = e.target.value;
      await loadStudentsForAdminClass(selectedAdminClassId);
    });
  }

  if (formAddStudent) {
    formAddStudent.addEventListener('submit', handleAddSingleStudent);
  }

  if (csvFileInput) {
    csvFileInput.addEventListener('change', handleCSVFileSelect);
  }

  if (btnConfirmCsvImport) {
    btnConfirmCsvImport.addEventListener('click', handleExecuteCSVImport);
  }
}

function refreshStudentClassDropdown() {
  const dropdown = document.getElementById('admin-student-class-filter');
  const singleAddDropdown = document.getElementById('student-add-class');
  const csvClassDropdown = document.getElementById('csv-target-class');

  const optionsHtml = allSchoolClasses.map(c => 
    `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)} (${Number(c.studentCount) || 0} stds)</option>`
  ).join('');

  if (dropdown) {
    dropdown.innerHTML = `<option value="">-- Select Class --</option>` + optionsHtml;
    if (selectedAdminClassId) {
      dropdown.value = selectedAdminClassId;
    }
  }

  if (singleAddDropdown) {
    singleAddDropdown.innerHTML = `<option value="">-- Choose Class --</option>` + optionsHtml;
  }

  if (csvClassDropdown) {
    csvClassDropdown.innerHTML = `<option value="">-- Select Target Class --</option>` + optionsHtml;
  }
}

/**
 * Queries students strictly filtered by classId (30-40 documents per read)
 * Reuses in-memory classStudentsCache to avoid re-reading active students on every tab or filter change
 */
async function loadStudentsForAdminClass(classId, forceRefresh = false) {
  const tbody = document.getElementById('table-students-body');
  if (!tbody) return;

  if (!classId) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-8 text-center text-gray-400">
          Please select a class above to view and manage students.
        </td>
      </tr>
    `;
    return;
  }

  // Check in-memory cache first to avoid re-fetching 30-40 student documents
  if (!forceRefresh && classStudentsCache[classId]) {
    currentAdminClassStudents = [...classStudentsCache[classId]];
    renderAdminStudentsTable();
    return;
  }

  tbody.innerHTML = `
    <tr>
      <td colspan="6" class="px-6 py-8 text-center text-gray-500">
        <svg class="animate-spin h-5 w-5 text-indigo-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        Loading students...
      </td>
    </tr>
  `;

  try {
    const q = query(
      collection(db, 'students'),
      where('classId', '==', classId),
      where('status', '==', 'active')
    );
    const snap = await getDocs(q);

    currentAdminClassStudents = [];
    snap.forEach(d => {
      currentAdminClassStudents.push({ id: d.id, ...d.data() });
    });

    currentAdminClassStudents.sort((a, b) => {
      const numA = parseInt(a.rollNo, 10);
      const numB = parseInt(b.rollNo, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return String(a.rollNo).localeCompare(String(b.rollNo));
    });

    // Cache in memory for instant subsequent lookups
    classStudentsCache[classId] = [...currentAdminClassStudents];

    // Update class studentCount cache if out of sync
    const classObj = allSchoolClasses.find(c => c.id === classId);
    if (classObj && classObj.studentCount !== currentAdminClassStudents.length) {
      updateDoc(doc(db, 'classes', classId), { studentCount: currentAdminClassStudents.length }).catch(() => {});
      classObj.studentCount = currentAdminClassStudents.length;
    }

    renderAdminStudentsTable();
  } catch (error) {
    console.error('Error loading students:', error);
    showToast('Failed to load students: ' + error.message, 'error');
  }
}

function renderAdminStudentsTable() {
  const tbody = document.getElementById('table-students-body');
  if (!tbody) return;

  if (currentAdminClassStudents.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-8 text-center text-gray-400">
          No students found in this class. Use "Add Student" or "Bulk CSV Import" below.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = currentAdminClassStudents.map(s => `
    <tr class="border-b border-gray-100 hover:bg-gray-50/50 transition">
      <td class="px-6 py-4 font-bold text-gray-900">${escapeHTML(s.rollNo)}</td>
      <td class="px-6 py-4 font-semibold text-gray-800">${escapeHTML(s.name)}</td>
      <td class="px-6 py-4 text-gray-600">${s.fatherName ? escapeHTML(s.fatherName) : '—'}</td>
      <td class="px-6 py-4 text-gray-600">
        ${s.parentPhone ? `<span class="font-mono text-xs">📞 ${escapeHTML(s.parentPhone)}</span>` : '<span class="text-gray-400 text-xs">None</span>'}
      </td>
      <td class="px-6 py-4 text-gray-600">${s.gender ? escapeHTML(s.gender) : '—'}</td>
      <td class="px-6 py-4 text-right space-x-2">
        <button onclick="window.deleteStudentPrompt('${escapeHTML(s.id)}', this.dataset.name, '${escapeHTML(s.classId)}')" 
                data-name="${escapeHTML(s.name)}"
                class="text-rose-600 hover:text-rose-800 text-xs font-semibold p-1 hover:bg-rose-50 rounded-lg transition">
          Remove
        </button>
      </td>
    </tr>
  `).join('');
}

async function handleAddSingleStudent(e) {
  e.preventDefault();
  const classSelect = document.getElementById('student-add-class');
  const rollInput = document.getElementById('student-roll');
  const nameInput = document.getElementById('student-name');
  const fatherInput = document.getElementById('student-father');
  const phoneInput = document.getElementById('student-phone');
  const genderInput = document.getElementById('student-gender');

  const classId = classSelect.value;
  const rollNo = rollInput.value.trim();
  const name = nameInput.value.trim();
  const fatherName = fatherInput.value.trim();
  const parentPhone = phoneInput.value.trim();
  const gender = genderInput.value;

  if (!classId || !rollNo || !name) {
    showToast('Please specify Class, Roll Number, and Student Name.', 'warning');
    return;
  }

  // Consistent ID pattern: std_{classId}_{rollNo}
  const studentDocId = `std_${classId}_${rollNo.replace(/[^a-zA-Z0-9]/g, '_')}`;

  try {
    await setDoc(doc(db, 'students', studentDocId), {
      rollNo,
      name,
      fatherName,
      parentPhone,
      gender,
      classId,
      status: 'active',
      createdAt: serverTimestamp()
    }, { merge: true });

    showToast(`Student "${name}" added successfully!`, 'success');
    rollInput.value = '';
    nameInput.value = '';
    fatherInput.value = '';
    phoneInput.value = '';

    // Invalidate student cache for this class
    delete classStudentsCache[classId];

    // If currently viewing this class, refresh
    if (selectedAdminClassId === classId) {
      await loadStudentsForAdminClass(classId, true);
    }
    await loadAllClasses(true);
  } catch (error) {
    console.error('Error adding student:', error);
    showToast('Failed to add student: ' + error.message, 'error');
  }
}

window.deleteStudentPrompt = async function(studentId, studentName, classId) {
  const targetStudent = currentAdminClassStudents.find(s => s.id === studentId);
  const displayName = studentName || (targetStudent ? targetStudent.name : 'this student');
  if (!confirm(`Are you sure you want to remove student "${displayName}"?`)) {
    return;
  }

  try {
    // Soft delete by setting status: 'inactive'
    await updateDoc(doc(db, 'students', studentId), { status: 'inactive' });
    showToast(`Student "${displayName}" removed.`, 'info');
    delete classStudentsCache[classId];
    await loadStudentsForAdminClass(classId, true);
    await loadAllClasses(true);
  } catch (error) {
    console.error('Error removing student:', error);
    showToast('Failed to remove student: ' + error.message, 'error');
  }
};
    console.error('Error removing student:', error);
    showToast('Failed to remove student: ' + error.message, 'error');
  }
};

/**
 * CSV File Selection & Preview Handler
 */
function handleCSVFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const text = evt.target.result;
      parsedCSVStudents = parseStudentsCSV(text);

      const previewContainer = document.getElementById('csv-preview-container');
      const previewCount = document.getElementById('csv-preview-count');
      const previewTbody = document.getElementById('csv-preview-tbody');

      if (parsedCSVStudents.length === 0) {
        showToast('No valid student rows found in CSV. Check required columns.', 'warning');
        return;
      }

      if (previewCount) previewCount.textContent = parsedCSVStudents.length;
      if (previewTbody) {
        previewTbody.innerHTML = parsedCSVStudents.slice(0, 10).map(s => `
          <tr class="border-b border-gray-100 text-xs">
            <td class="px-3 py-2 font-bold">${escapeHTML(s.rollNo)}</td>
            <td class="px-3 py-2 font-medium">${escapeHTML(s.name)}</td>
            <td class="px-3 py-2">${escapeHTML(s.fatherName)}</td>
            <td class="px-3 py-2 font-mono">${escapeHTML(s.parentPhone)}</td>
            <td class="px-3 py-2">${escapeHTML(s.gender)}</td>
          </tr>
        `).join('') + (parsedCSVStudents.length > 10 ? `<tr><td colspan="5" class="px-3 py-2 text-center text-gray-400 text-xs font-italic">...and ${parsedCSVStudents.length - 10} more rows</td></tr>` : '');
      }

      if (previewContainer) previewContainer.classList.remove('hidden');
    } catch (err) {
      console.error('CSV Parsing error:', err);
      showToast('Error reading CSV: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

/**
 * Execute Bulk CSV Import with chunked batch writes (Firestore 500 limit safety)
 */
async function handleExecuteCSVImport() {
  const targetClassSelect = document.getElementById('csv-target-class');
  const targetClassId = targetClassSelect ? targetClassSelect.value : null;

  if (!targetClassId) {
    showToast('Please select a target class for the imported students.', 'warning');
    return;
  }

  if (parsedCSVStudents.length === 0) {
    showToast('No students to import.', 'warning');
    return;
  }

  const btnConfirm = document.getElementById('btn-confirm-csv-import');
  const originalHtml = btnConfirm ? btnConfirm.innerHTML : 'Import';

  try {
    if (btnConfirm) {
      btnConfirm.disabled = true;
      btnConfirm.innerHTML = `Importing (${parsedCSVStudents.length} students)...`;
    }

    // Process in batches of 400 (well under Firestore's 500 limit)
    const BATCH_SIZE = 400;
    for (let i = 0; i < parsedCSVStudents.length; i += BATCH_SIZE) {
      const slice = parsedCSVStudents.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);

      slice.forEach(student => {
        const docId = `std_${targetClassId}_${student.rollNo.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const docRef = doc(db, 'students', docId);
        batch.set(docRef, {
          rollNo: student.rollNo,
          name: student.name,
          fatherName: student.fatherName || '',
          parentPhone: student.parentPhone || '',
          gender: student.gender || 'Unspecified',
          classId: targetClassId,
          status: 'active',
          createdAt: serverTimestamp()
        }, { merge: true });
      });

      await batch.commit();
    }

    showToast(`Successfully imported ${parsedCSVStudents.length} students!`, 'success');
    parsedCSVStudents = [];
    document.getElementById('csv-file-input').value = '';
    document.getElementById('csv-preview-container').classList.add('hidden');

    // Invalidate student cache for target class
    delete classStudentsCache[targetClassId];

    if (selectedAdminClassId === targetClassId) {
      await loadStudentsForAdminClass(targetClassId, true);
    }
    await loadAllClasses(true);
  } catch (error) {
    console.error('Bulk import error:', error);
    showToast('Bulk import failed: ' + error.message, 'error');
  } finally {
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.innerHTML = originalHtml;
    }
  }
}

/* =====================================================================
   3. TEACHER MANAGEMENT & CLASS ASSIGNMENTS
   ===================================================================== */

function setupTeacherManagementListeners() {
  const formAddTeacher = document.getElementById('form-add-teacher');
  if (formAddTeacher) {
    formAddTeacher.addEventListener('submit', handleAddTeacherProfile);
  }
}

function renderTeachersList(teachers) {
  const container = document.getElementById('teachers-list-container');
  if (!container) return;

  if (teachers.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-gray-400 bg-white rounded-2xl border border-gray-100">
        No teacher profiles found. Add teachers above to assign classes.
      </div>
    `;
    return;
  }

  container.innerHTML = teachers.map(t => {
    const assignedNames = (t.assignedClassIds || []).map(cId => {
      const found = allSchoolClasses.find(c => c.id === cId);
      return found ? found.name : cId;
    });

    return `
      <div class="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div class="font-bold text-gray-900 text-base flex items-center gap-2">
            ${escapeHTML(t.name)}
            <span class="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold">Teacher</span>
          </div>
          <div class="text-xs text-gray-500 mt-0.5 font-mono">✉️ ${escapeHTML(t.email)} ${t.phone ? `• 📞 ${escapeHTML(t.phone)}` : ''} • <span class="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">UID: ${escapeHTML(t.id)}</span></div>
          <div class="mt-2.5 flex flex-wrap gap-1.5">
            ${assignedNames.length > 0 
              ? assignedNames.map(cn => `<span class="px-2.5 py-1 rounded-lg text-xs bg-indigo-50 text-indigo-700 font-semibold">${escapeHTML(cn)}</span>`).join('')
              : `<span class="text-xs text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-lg">No classes assigned</span>`
            }
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="window.editTeacherClasses('${escapeHTML(t.id)}', '${encodeURIComponent(JSON.stringify(t.assignedClassIds || []))}')"
                  class="px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700 transition">
            Edit Classes
          </button>
          <button onclick="window.deleteTeacherPrompt('${escapeHTML(t.id)}', this.dataset.name)"
                  data-name="${escapeHTML(t.name)}"
                  class="px-3 py-1.5 rounded-xl border border-rose-200 hover:bg-rose-50 text-xs font-semibold text-rose-600 transition">
            Delete
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function loadTeachersList(forceRefresh = false) {
  const container = document.getElementById('teachers-list-container');
  const classCheckboxContainer = document.getElementById('teacher-class-checkboxes');

  // Render class checkboxes for assignment
  if (classCheckboxContainer) {
    classCheckboxContainer.innerHTML = allSchoolClasses.map(c => `
      <label class="flex items-center gap-2 p-2 bg-gray-50 hover:bg-gray-100 rounded-xl cursor-pointer text-xs font-medium text-gray-700">
        <input type="checkbox" name="assignClass" value="${escapeHTML(c.id)}" class="rounded text-indigo-600 focus:ring-indigo-500">
        <span>${escapeHTML(c.name)}</span>
      </label>
    `).join('');
  }

  if (!container) return;

  // Use in-memory cache if available
  if (!forceRefresh && cachedTeachersList) {
    renderTeachersList(cachedTeachersList);
    return;
  }

  try {
    const q = query(collection(db, 'users'), where('role', '==', 'teacher'));
    const snap = await getDocs(q);

    const teachers = [];
    snap.forEach(d => teachers.push({ id: d.id, ...d.data() }));
    cachedTeachersList = teachers;

    renderTeachersList(teachers);
  } catch (error) {
    console.error('Error loading teachers:', error);
    showToast('Failed to load teachers: ' + error.message, 'error');
  }
}

async function handleAddTeacherProfile(e) {
  e.preventDefault();
  const nameInput = document.getElementById('teacher-name');
  const emailInput = document.getElementById('teacher-email');
  const uidInput = document.getElementById('teacher-uid');
  const phoneInput = document.getElementById('teacher-phone');
  const selectedBoxes = document.querySelectorAll('input[name="assignClass"]:checked');

  const name = nameInput.value.trim();
  const email = emailInput.value.trim().toLowerCase();
  const uid = uidInput ? uidInput.value.trim() : '';
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const assignedClassIds = Array.from(selectedBoxes).map(b => b.value);

  if (!name || !email) {
    showToast('Name and Email are required for teacher profiles.', 'warning');
    return;
  }

  if (!uid) {
    showToast('Firebase Auth UID is required. Create user in Firebase Console > Authentication first.', 'warning');
    return;
  }

  try {
    const userDocId = uid;

    await setDoc(doc(db, 'users', userDocId), {
      uid: userDocId,
      name,
      email,
      phone,
      role: 'teacher',
      assignedClassIds,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    showToast(`Teacher profile for "${name}" registered!`, 'success');
    nameInput.value = '';
    emailInput.value = '';
    if (uidInput) uidInput.value = '';
    if (phoneInput) phoneInput.value = '';
    selectedBoxes.forEach(b => b.checked = false);

    cachedTeachersList = null;
    await loadTeachersList(true);
  } catch (error) {
    console.error('Error creating teacher:', error);
    showToast('Failed to create teacher profile: ' + error.message, 'error');
  }
}

window.editTeacherClasses = async function(teacherId, classIdsJson) {
  const currentAssigned = JSON.parse(decodeURIComponent(classIdsJson));
  
  // Prompt or simple multi-select prompt
  const classListText = allSchoolClasses.map((c, i) => `${i + 1}. ${c.name} (${c.id})`).join('\n');
  const input = prompt(`Enter comma-separated numbers (e.g. 1, 2) of classes to assign:\n\n${classListText}`);
  if (input === null) return;

  const selectedIndices = input.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(idx => idx >= 0 && idx < allSchoolClasses.length);
  const newAssignedIds = selectedIndices.map(idx => allSchoolClasses[idx].id);

  try {
    await updateDoc(doc(db, 'users', teacherId), {
      assignedClassIds: newAssignedIds,
      updatedAt: serverTimestamp()
    });
    showToast('Teacher class assignments updated!', 'success');
    cachedTeachersList = null;
    await loadTeachersList(true);
  } catch (error) {
    console.error('Error updating teacher:', error);
    showToast('Failed to update teacher: ' + error.message, 'error');
  }
};

window.deleteTeacherPrompt = async function(teacherId, teacherName) {
  const displayName = teacherName || 'this teacher';
  if (!confirm(`Are you sure you want to delete profile for "${displayName}"?`)) return;

  try {
    await deleteDoc(doc(db, 'users', teacherId));
    showToast(`Teacher profile "${displayName}" removed.`, 'info');
    cachedTeachersList = null;
    await loadTeachersList(true);
  } catch (error) {
    console.error('Error deleting teacher:', error);
    showToast('Failed to delete teacher: ' + error.message, 'error');
  }
};

/* =====================================================================
   4. SCHOOL-WIDE DAILY OVERVIEW & ADMIN OVERRIDE
   ===================================================================== */

function setupDailyOverviewListeners() {
  const dateInput = document.getElementById('admin-overview-date');
  const btnRefresh = document.getElementById('btn-refresh-overview');

  if (dateInput) {
    dateInput.value = getTodayDateString();
    dateInput.addEventListener('change', loadDailyOverview);
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', loadDailyOverview);
  }
}

async function loadDailyOverview() {
  const dateInput = document.getElementById('admin-overview-date');
  const selectedDate = dateInput ? dateInput.value : getTodayDateString();
  const container = document.getElementById('admin-overview-grid');

  if (!container) return;

  container.innerHTML = `
    <div class="col-span-full p-8 text-center text-gray-500">
      <svg class="animate-spin h-6 w-6 text-indigo-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
      Loading school-wide attendance for ${formatReadableDate(selectedDate)}...
    </div>
  `;

  try {
    // Read attendance documents for this date across classes
    // Only ~35 reads max!
    let totalSchoolPresent = 0;
    let totalSchoolAbsent = 0;
    let totalSchoolStudents = 0;
    let markedClassesCount = 0;

    const classCards = await Promise.all(allSchoolClasses.map(async (cls) => {
      const docId = `${cls.id}_${selectedDate}`;
      const snap = await getDoc(doc(db, 'attendance', docId));

      let isMarked = false;
      let summary = { total: cls.studentCount || 0, present: 0, absent: 0, late: 0, excused: 0 };
      let markedByName = 'Unmarked';

      if (snap.exists()) {
        isMarked = true;
        const d = snap.data();
        summary = d.summary || summary;
        markedByName = d.markedByName || 'Teacher';
        markedClassesCount++;
        totalSchoolPresent += summary.present || 0;
        totalSchoolAbsent += summary.absent || 0;
        totalSchoolStudents += summary.total || 0;
      } else {
        totalSchoolStudents += cls.studentCount || 0;
      }

      const percent = summary.total > 0 ? Math.round(((summary.present + (summary.late * 0.5)) / summary.total) * 100) : 0;

      return `
        <div class="bg-white rounded-2xl p-5 border ${isMarked ? 'border-emerald-100 shadow-sm' : 'border-amber-100 bg-amber-50/20'} flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <h4 class="font-bold text-gray-900">${escapeHTML(cls.name)}</h4>
              ${isMarked 
                ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">Marked (${percent}%)</span>` 
                : `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">Pending</span>`
              }
            </div>
            <div class="text-xs text-gray-500 mb-3">Marked by: <span class="font-medium text-gray-700">${escapeHTML(markedByName)}</span></div>

            <div class="grid grid-cols-4 gap-1 text-center py-2 bg-gray-50 rounded-xl mb-3 text-xs">
              <div>
                <span class="block font-bold text-gray-700">${summary.total}</span>
                <span class="text-gray-400 text-[10px]">Total</span>
              </div>
              <div>
                <span class="block font-bold text-emerald-600">${summary.present}</span>
                <span class="text-gray-400 text-[10px]">Pres</span>
              </div>
              <div>
                <span class="block font-bold text-rose-600">${summary.absent}</span>
                <span class="text-gray-400 text-[10px]">Abs</span>
              </div>
              <div>
                <span class="block font-bold text-amber-600">${summary.late}</span>
                <span class="text-gray-400 text-[10px]">Late</span>
              </div>
            </div>
          </div>

          <button onclick="window.adminOpenAttendanceModal('${escapeHTML(cls.id)}', '${escapeHTML(selectedDate)}')"
                  class="w-full mt-2 py-1.5 px-3 rounded-xl text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition">
            ${isMarked ? 'Review / Edit Attendance' : 'Mark Attendance (Admin Override)'}
          </button>
        </div>
      `;
    }));

    container.innerHTML = classCards.join('');

    // Update overall metric cards
    const overallRate = totalSchoolStudents > 0 ? Math.round((totalSchoolPresent / totalSchoolStudents) * 100) : 0;
    const statRate = document.getElementById('admin-stat-overall-rate');
    const statPresent = document.getElementById('admin-stat-school-present');
    const statAbsent = document.getElementById('admin-stat-school-absent');
    const statMarkedClasses = document.getElementById('admin-stat-marked-classes');

    if (statRate) statRate.textContent = `${overallRate}%`;
    if (statPresent) statPresent.textContent = totalSchoolPresent;
    if (statAbsent) statAbsent.textContent = totalSchoolAbsent;
    if (statMarkedClasses) statMarkedClasses.textContent = `${markedClassesCount} / ${allSchoolClasses.length}`;
  } catch (error) {
    console.error('Error loading daily overview:', error);
    showToast('Failed to load daily overview: ' + error.message, 'error');
  }
}

/**
 * Admin Attendance Override Modal
 * Allows Admins to view and edit attendance for ANY class and ANY date!
 */
window.adminOpenAttendanceModal = async function(classId, dateStr) {
  const modal = document.getElementById('modal-admin-attendance');
  const modalTitle = document.getElementById('modal-admin-attendance-title');
  const modalBody = document.getElementById('modal-admin-attendance-body');

  if (!modal) return;
  const targetClass = allSchoolClasses.find(c => c.id === classId);
  const className = targetClass ? targetClass.name : classId;

  if (modalTitle) {
    modalTitle.textContent = `${className} — ${formatReadableDate(dateStr)}`;
  }

  modal.classList.remove('hidden');
  modalBody.innerHTML = `<div class="p-8 text-center text-gray-500">Loading student attendance...</div>`;

  try {
    // 1. Get students for class (check in-memory cache first to save quota)
    let students = [];
    if (classStudentsCache[classId]) {
      students = [...classStudentsCache[classId]];
    } else {
      const q = query(
        collection(db, 'students'), 
        where('classId', '==', classId),
        where('status', '==', 'active')
      );
      const studentsSnap = await getDocs(q);
      studentsSnap.forEach(d => students.push({ id: d.id, ...d.data() }));
      students.sort((a, b) => {
        const numA = parseInt(a.rollNo, 10);
        const numB = parseInt(b.rollNo, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a.rollNo).localeCompare(String(b.rollNo));
      });
      classStudentsCache[classId] = [...students];
    }

    // 2. Get attendance doc
    const docId = `${classId}_${dateStr}`;
    const attSnap = await getDoc(doc(db, 'attendance', docId));
    const records = attSnap.exists() ? (attSnap.data().records || {}) : {};

    let html = `
      <form id="form-admin-attendance-override" onsubmit="window.saveAdminAttendanceOverride(event, '${escapeHTML(classId)}', '${escapeHTML(dateStr)}')">
        <div class="space-y-3 max-h-96 overflow-y-auto p-1">
    `;

    students.forEach(s => {
      const rec = records[s.id] || { status: 'P', remarks: '' };
      html += `
        <div class="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
          <div class="flex items-center gap-3">
            <span class="w-8 h-8 rounded-lg bg-white flex items-center justify-center font-bold text-xs text-gray-700 shadow-sm">
              ${escapeHTML(s.rollNo)}
            </span>
            <div>
              <div class="font-bold text-gray-800 text-sm">${escapeHTML(s.name)}</div>
              <div class="text-[11px] text-gray-400">S/O ${s.fatherName ? escapeHTML(s.fatherName) : '—'}</div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <select name="status_${escapeHTML(s.id)}" class="text-xs font-bold rounded-lg border-gray-200 bg-white p-1.5 focus:ring-indigo-500">
              <option value="P" ${rec.status === 'P' ? 'selected' : ''}>Present</option>
              <option value="A" ${rec.status === 'A' ? 'selected' : ''}>Absent</option>
              <option value="L" ${rec.status === 'L' ? 'selected' : ''}>Late</option>
              <option value="E" ${rec.status === 'E' ? 'selected' : ''}>Excused</option>
            </select>
          </div>
        </div>
      `;
    });

    html += `
        </div>
        <div class="mt-4 pt-3 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onclick="document.getElementById('modal-admin-attendance').classList.add('hidden')"
                  class="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100 transition">
            Cancel
          </button>
          <button type="submit" 
                  class="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-sm">
            Save Changes (Admin Override)
          </button>
        </div>
      </form>
    `;

    modalBody.innerHTML = html;
  } catch (error) {
    console.error('Error opening override modal:', error);
    modalBody.innerHTML = `<div class="p-6 text-center text-rose-600 text-sm">Failed to load attendance: ${escapeHTML(error.message)}</div>`;
  }
};

window.saveAdminAttendanceOverride = async function(e, classId, dateStr) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  const records = {};
  let present = 0, absent = 0, late = 0, excused = 0, total = 0;

  for (const [key, value] of formData.entries()) {
    if (key.startsWith('status_')) {
      const studentId = key.replace('status_', '');
      records[studentId] = {
        status: value,
        remarks: 'Admin updated',
        updatedAt: new Date().toISOString()
      };
      total++;
      if (value === 'P') present++;
      else if (value === 'A') absent++;
      else if (value === 'L') late++;
      else if (value === 'E') excused++;
    }
  }

  const docId = `${classId}_${dateStr}`;
  const targetClass = allSchoolClasses.find(c => c.id === classId);

  try {
    await setDoc(doc(db, 'attendance', docId), {
      classId,
      className: targetClass ? targetClass.name : classId,
      date: dateStr,
      academicYear: targetClass?.academicYear || '2026-2027',
      markedBy: adminUser.uid,
      markedByName: `${adminUser.name} (Admin)`,
      summary: { total, present, absent, late, excused },
      records,
      updatedAt: serverTimestamp()
    }, { merge: true });

    showToast('Attendance updated by Administrator!', 'success');
    document.getElementById('modal-admin-attendance').classList.add('hidden');
    await loadDailyOverview();
  } catch (error) {
    console.error('Error saving admin override:', error);
    showToast('Failed to save override: ' + error.message, 'error');
  }
};

/* =====================================================================
   5. MONTHLY REPORTS & LOW ATTENDANCE RADAR (<75%)
   ===================================================================== */

let currentReportData = {
  classObj: null,
  monthStr: '',
  dates: [],
  students: [],
  attendanceMap: {}, // date -> records
  summaryMap: {}     // studentId -> { present, absent, late, excused, total, percent }
};

function setupReportListeners() {
  const btnGenerate = document.getElementById('btn-generate-report');

  if (btnGenerate) {
    btnGenerate.addEventListener('click', generateMonthlyReport);
  }

  // Set default month in report picker
  const monthInput = document.getElementById('report-month-select');
  if (monthInput) {
    const now = new Date();
    const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    monthInput.value = curMonth;
  }
}

function refreshReportClassDropdown() {
  const dropdown = document.getElementById('report-class-select');
  if (dropdown) {
    dropdown.innerHTML = allSchoolClasses.map(c => 
      `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`
    ).join('');
  }
}

async function generateMonthlyReport() {
  const classSelect = document.getElementById('report-class-select');
  const monthInput = document.getElementById('report-month-select');
  const reportContainer = document.getElementById('report-results-container');

  const classId = classSelect ? classSelect.value : null;
  const monthStr = monthInput ? monthInput.value : '';

  if (!classId || !monthStr) {
    showToast('Please select both a class and a month.', 'warning');
    return;
  }

  const classObj = allSchoolClasses.find(c => c.id === classId);
  currentReportData.classObj = classObj;
  currentReportData.monthStr = monthStr;

  if (reportContainer) {
    reportContainer.innerHTML = `
      <div class="p-12 text-center text-gray-500">
        <svg class="animate-spin h-6 w-6 text-indigo-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        Generating report for ${escapeHTML(classObj.name)} (${escapeHTML(monthStr)})...
      </div>
    `;
  }

  try {
    // 1. Fetch Students for this class (reuse in-memory cache if already loaded)
    let students = [];
    if (classStudentsCache[classId]) {
      students = [...classStudentsCache[classId]];
    } else {
      const qStudents = query(
        collection(db, 'students'),
        where('classId', '==', classId),
        where('status', '==', 'active')
      );
      const snapStudents = await getDocs(qStudents);
      snapStudents.forEach(d => students.push({ id: d.id, ...d.data() }));
      students.sort((a, b) => {
        const numA = parseInt(a.rollNo, 10);
        const numB = parseInt(b.rollNo, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a.rollNo).localeCompare(String(b.rollNo));
      });
      classStudentsCache[classId] = [...students];
    }
    currentReportData.students = students;

    // 2. Fetch all attendance docs for this class and month (typically ~20-25 school days = 25 reads!)
    const startDate = `${monthStr}-01`;
    const endDate = `${monthStr}-31`;

    const qAttendance = query(
      collection(db, 'attendance'),
      where('classId', '==', classId),
      where('date', '>=', startDate),
      where('date', '<=', endDate)
    );
    const snapAttendance = await getDocs(qAttendance);

    const attendanceDocs = [];
    snapAttendance.forEach(d => attendanceDocs.push(d.data()));
    attendanceDocs.sort((a, b) => a.date.localeCompare(b.date));

    currentReportData.dates = attendanceDocs.map(d => d.date);
    currentReportData.attendanceMap = {};
    attendanceDocs.forEach(d => {
      currentReportData.attendanceMap[d.date] = d.records || {};
    });

    // 3. Compute student statistics
    currentReportData.summaryMap = {};
    students.forEach(student => {
      let present = 0, absent = 0, late = 0, excused = 0;
      attendanceDocs.forEach(d => {
        const rec = d.records ? d.records[student.id] : null;
        if (rec) {
          if (rec.status === 'P') present++;
          else if (rec.status === 'A') absent++;
          else if (rec.status === 'L') late++;
          else if (rec.status === 'E') excused++;
        }
      });

      const totalSchoolDays = attendanceDocs.length;
      // Formula: (Present + Late * 0.5) / Total Days * 100%
      const percent = totalSchoolDays > 0 ? Math.round(((present + (late * 0.5)) / totalSchoolDays) * 100) : 0;

      currentReportData.summaryMap[student.id] = {
        present,
        absent,
        late,
        excused,
        totalSchoolDays,
        percent
      };
    });

    renderReportView();
  } catch (error) {
    console.error('Error generating report:', error);
    showToast('Failed to generate report: ' + error.message, 'error');
  }
}

function renderReportView() {
  const container = document.getElementById('report-results-container');
  if (!container) return;

  const { classObj, monthStr, dates, students, summaryMap } = currentReportData;

  // Filter low-attendance students (<75%)
  const lowAttendanceStudents = students.filter(s => {
    const stat = summaryMap[s.id];
    return stat && stat.totalSchoolDays > 0 && stat.percent < 75;
  });

  let html = `
    <!-- Action Controls & Header -->
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
      <div>
        <h3 class="text-xl font-bold text-gray-900">${escapeHTML(classObj.name)} — Monthly Attendance Register</h3>
        <p class="text-xs text-gray-500 mt-1">Month: <span class="font-semibold text-gray-700">${escapeHTML(monthStr)}</span> • Working Days: <span class="font-semibold text-gray-700">${dates.length}</span> • Total Students: <span class="font-semibold text-gray-700">${students.length}</span></p>
      </div>
      <div class="flex items-center gap-2 print:hidden">
        <button id="btn-export-report-csv" onclick="window.triggerReportCSVDownload()"
                class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition inline-flex items-center gap-1.5">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          Export CSV
        </button>
        <button id="btn-export-report-json" onclick="window.triggerReportJSONDownload()"
                class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition inline-flex items-center gap-1.5" title="Export Full Month JSON Backup">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          Backup JSON
        </button>
        <button onclick="window.print()" 
                class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-gray-800 hover:bg-gray-900 text-white shadow-sm transition inline-flex items-center gap-1.5">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
          Print Register
        </button>
      </div>
    </div>
  `;

  // 1. Low Attendance Radar Section
  if (lowAttendanceStudents.length > 0) {
    html += `
      <div class="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200">
        <div class="flex items-center gap-2 mb-3">
          <svg class="w-5 h-5 text-rose-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          <h4 class="font-bold text-rose-900 text-sm">Low Attendance Radar (${lowAttendanceStudents.length} Students Below 75%):</h4>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          ${lowAttendanceStudents.map(s => {
            const stat = summaryMap[s.id];
            const waLink = createLowAttendanceWhatsAppLink(s.parentPhone, s.name, s.rollNo, stat.percent, stat.totalSchoolDays, stat.present);
            return `
              <div class="bg-white p-3 rounded-xl border border-rose-100 flex items-center justify-between gap-2 shadow-xs">
                <div>
                  <div class="font-bold text-gray-800 text-xs">${escapeHTML(s.rollNo)}. ${escapeHTML(s.name)}</div>
                  <div class="text-[11px] text-rose-600 font-semibold">${stat.percent}% (${stat.present}/${stat.totalSchoolDays} days)</div>
                </div>
                ${waLink ? `
                  <a href="${escapeHTML(waLink)}" target="_blank" rel="noopener noreferrer"
                     title="Send WhatsApp Low-Attendance Warning"
                     class="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[10px] font-bold inline-flex items-center gap-1 flex-shrink-0 transition">
                    Notify
                  </a>
                ` : `<span class="text-[10px] text-gray-400">No Phone</span>`}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // 2. Full Matrix Table (Responsive / Print Friendly)
  html += `
    <div class="overflow-x-auto bg-white rounded-2xl border border-gray-100 shadow-sm">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold">
          <tr>
            <th class="px-3 py-3 border-r border-gray-200 w-12 text-center sticky left-0 bg-gray-50">Roll</th>
            <th class="px-4 py-3 border-r border-gray-200 min-w-[140px] sticky left-12 bg-gray-50">Student Name</th>
            ${dates.map(d => `<th class="px-1.5 py-3 border-r border-gray-100 text-center font-mono text-[10px] min-w-[28px]">${d.split('-')[2]}</th>`).join('')}
            <th class="px-2 py-3 border-r border-gray-200 text-center bg-emerald-50 text-emerald-800">P</th>
            <th class="px-2 py-3 border-r border-gray-200 text-center bg-rose-50 text-rose-800">A</th>
            <th class="px-2 py-3 border-r border-gray-200 text-center bg-amber-50 text-amber-800">L</th>
            <th class="px-3 py-3 text-center bg-indigo-50 text-indigo-900 font-bold">%</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
  `;

  students.forEach(s => {
    const stat = summaryMap[s.id] || { present: 0, absent: 0, late: 0, percent: 0 };
    const isLow = stat.percent < 75 && dates.length > 0;

    html += `
      <tr class="hover:bg-gray-50/70 transition ${isLow ? 'bg-rose-50/20' : ''}">
        <td class="px-3 py-2 text-center font-bold text-gray-700 border-r border-gray-200 sticky left-0 bg-white">${escapeHTML(s.rollNo)}</td>
        <td class="px-4 py-2 font-medium text-gray-900 border-r border-gray-200 sticky left-12 bg-white truncate max-w-[140px]">${escapeHTML(s.name)}</td>
        ${dates.map(d => {
          const rec = currentReportData.attendanceMap[d] ? currentReportData.attendanceMap[d][s.id] : null;
          const status = rec ? rec.status : '—';
          let color = 'text-gray-300';
          if (status === 'P') color = 'text-emerald-600 font-bold';
          else if (status === 'A') color = 'text-rose-600 font-bold bg-rose-100/50';
          else if (status === 'L') color = 'text-amber-600 font-bold';
          else if (status === 'E') color = 'text-blue-600 font-bold';

          return `<td class="px-1 py-1.5 text-center border-r border-gray-100 text-[11px] ${color}">${status}</td>`;
        }).join('')}
        <td class="px-2 py-2 text-center font-bold text-emerald-700 border-r border-gray-200 bg-emerald-50/30">${stat.present}</td>
        <td class="px-2 py-2 text-center font-bold text-rose-700 border-r border-gray-200 bg-rose-50/30">${stat.absent}</td>
        <td class="px-2 py-2 text-center font-bold text-amber-700 border-r border-gray-200 bg-amber-50/30">${stat.late}</td>
        <td class="px-3 py-2 text-center font-bold ${isLow ? 'text-rose-600 font-black' : 'text-indigo-700'} bg-indigo-50/30">
          ${stat.percent}%
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

window.triggerReportCSVDownload = function() {
  exportReportCSV();
};

function exportReportCSV() {
  const { classObj, monthStr, dates, students, summaryMap } = currentReportData;
  if (!classObj || students.length === 0) {
    showToast('Generate a report first before exporting.', 'warning');
    return;
  }

  const filename = `${classObj.name.replace(/[^a-zA-Z0-9]/g, '_')}_Attendance_${monthStr}.csv`;
  const headers = ['RollNo', 'StudentName', 'FatherName', ...dates, 'Present', 'Absent', 'Late', 'Excused', 'AttendancePercentage'];

  const rows = students.map(s => {
    const stat = summaryMap[s.id] || { present: 0, absent: 0, late: 0, excused: 0, percent: 0 };
    const dateValues = dates.map(d => {
      const rec = currentReportData.attendanceMap[d] ? currentReportData.attendanceMap[d][s.id] : null;
      return rec ? rec.status : '—';
    });

    return [
      s.rollNo,
      s.name,
      s.fatherName || '',
      ...dateValues,
      stat.present,
      stat.absent,
      stat.late,
      stat.excused,
      `${stat.percent}%`
    ];
  });

  downloadCSV(filename, headers, rows);
  showToast(`Downloaded ${filename}`, 'success');
}

window.triggerReportJSONDownload = function() {
  exportReportJSON();
};

function exportReportJSON() {
  const { classObj, monthStr, dates, students, summaryMap, attendanceMap } = currentReportData;
  if (!classObj || students.length === 0) {
    showToast('Generate a report first before exporting.', 'warning');
    return;
  }

  const backupData = {
    institution: "The Country School ShahJamal",
    backupType: "Monthly Attendance & Class Register",
    exportedAt: new Date().toISOString(),
    class: {
      id: classObj.id,
      name: classObj.name,
      grade: classObj.grade,
      section: classObj.section,
      academicYear: classObj.academicYear || "2026-2027"
    },
    month: monthStr,
    schoolDaysCount: dates.length,
    recordedDates: dates,
    attendanceByDate: attendanceMap,
    studentsSummary: students.map(s => ({
      rollNo: s.rollNo,
      name: s.name,
      fatherName: s.fatherName || '',
      stats: summaryMap[s.id] || {}
    }))
  };

  const filename = `${classObj.name.replace(/[^a-zA-Z0-9]/g, '_')}_Backup_${monthStr}.json`;
  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`Downloaded JSON Backup: ${filename}`, 'success');
}

/* =====================================================================
   6. EXAM TERMS & CLASS SUBJECTS CONFIGURATION
   ===================================================================== */

function setupExamManagementListeners() {
  const formAddTerm = document.getElementById('form-add-term');
  const classSelect = document.getElementById('config-subject-class');
  const formSaveSubjects = document.getElementById('form-save-class-subjects');

  if (formAddTerm) {
    formAddTerm.addEventListener('submit', handleAddTerm);
  }

  if (classSelect) {
    classSelect.addEventListener('change', (e) => {
      selectedConfigClassId = e.target.value;
      renderClassSubjectsForm();
    });
  }

  if (formSaveSubjects) {
    formSaveSubjects.addEventListener('submit', handleSaveClassSubjects);
  }
}

function renderExamTermsTable() {
  const tbody = document.getElementById('table-terms-body');
  if (!tbody) return;

  if (allExamTerms.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="px-6 py-8 text-center text-slate-400">
          No examination sessions created yet. Add your first term above.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = allExamTerms.map(t => {
    const isPublished = (t.status === 'published');
    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition">
        <td class="px-6 py-4 font-bold text-slate-900">${escapeHTML(t.name)}</td>
        <td class="px-6 py-4 text-slate-600">${escapeHTML(t.academicYear || '2026-2027')}</td>
        <td class="px-6 py-4">
          <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${isPublished ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
            ${isPublished ? 'Published to Parents' : 'Draft (Teachers Only)'}
          </span>
        </td>
        <td class="px-6 py-4 text-xs font-mono text-slate-400">${escapeHTML(t.id)}</td>
        <td class="px-6 py-4 text-right space-x-2">
          <button onclick="window.toggleTermStatus('${escapeHTML(t.id)}', '${isPublished ? 'draft' : 'published'}')" 
                  class="px-3 py-1.5 rounded-xl border text-xs font-bold transition ${isPublished ? 'border-amber-200 text-amber-700 hover:bg-amber-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}">
            ${isPublished ? 'Revert to Draft' : 'Publish Results'}
          </button>
          <button onclick="window.deleteTermPrompt('${escapeHTML(t.id)}', this.dataset.name)" 
                  data-name="${escapeHTML(t.name)}"
                  class="text-rose-600 hover:text-rose-800 text-xs font-semibold p-1 hover:bg-rose-50 rounded-lg transition">
            Delete
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadExamTermsList(forceRefresh = false) {
  const tbody = document.getElementById('table-terms-body');
  if (!tbody) return;

  if (!forceRefresh && allExamTerms.length > 0) {
    renderExamTermsTable();
    return;
  }

  try {
    const snap = await getDocs(collection(db, 'terms'));
    allExamTerms = [];
    snap.forEach(d => allExamTerms.push({ id: d.id, ...d.data() }));

    renderExamTermsTable();
  } catch (error) {
    console.error('Error loading exam terms:', error);
    showToast('Failed to load exam terms: ' + error.message, 'error');
  }
}

async function handleAddTerm(e) {
  e.preventDefault();
  const nameInput = document.getElementById('term-name');
  const yearInput = document.getElementById('term-academic-year');

  const name = nameInput.value.trim();
  const academicYear = yearInput ? yearInput.value.trim() : '2026-2027';

  if (!name) {
    showToast('Please enter an Examination Term Name.', 'warning');
    return;
  }

  // Consistent ID: term_{clean_name}_{year}
  const termId = `term_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${academicYear.replace(/[^a-z0-9]/g, '_')}`;

  try {
    await setDoc(doc(db, 'terms', termId), {
      name,
      academicYear,
      status: 'draft',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    showToast(`Exam Term "${name}" created (in Draft status)!`, 'success');
    nameInput.value = '';
    await loadExamTermsList(true);
  } catch (error) {
    console.error('Error creating term:', error);
    showToast('Failed to create term: ' + error.message, 'error');
  }
}

window.toggleTermStatus = async function(termId, newStatus) {
  const isPublishing = (newStatus === 'published');
  const msg = isPublishing
    ? 'Publishing will release all results to parents. Continue?'
    : 'Reverting to draft will hide results from parents and allow teachers to edit. Continue?';

  if (!confirm(msg)) return;

  try {
    // 1. Update term document
    await updateDoc(doc(db, 'terms', termId), {
      status: newStatus,
      updatedAt: serverTimestamp()
    });

    // 2. Update status in all results for this term
    const qResults = query(collection(db, 'results'), where('termId', '==', termId));
    const snapResults = await getDocs(qResults);

    if (!snapResults.empty) {
      const BATCH_SIZE = 400;
      const docs = snapResults.docs;
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        docs.slice(i, i + BATCH_SIZE).forEach(d => {
          batch.update(d.ref, { status: newStatus, updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }
    }

    showToast(`Exam term status updated to "${newStatus.toUpperCase()}"!`, 'success');
    await loadExamTermsList(true);
  } catch (error) {
    console.error('Error toggling term status:', error);
    showToast('Failed to update term status: ' + error.message, 'error');
  }
};

window.deleteTermPrompt = async function(termId, termName) {
  const targetTerm = allExamTerms.find(t => t.id === termId);
  const displayName = termName || (targetTerm ? targetTerm.name : 'this term');
  if (!confirm(`Are you sure you want to delete "${displayName}"?`)) return;

  try {
    await deleteDoc(doc(db, 'terms', termId));
    showToast(`Term "${displayName}" deleted.`, 'info');
    await loadExamTermsList(true);
  } catch (error) {
    console.error('Error deleting term:', error);
    showToast('Failed to delete term: ' + error.message, 'error');
  }
};

async function loadClassSubjectConfig() {
  const classSelect = document.getElementById('config-subject-class');
  if (!classSelect) return;

  classSelect.innerHTML = allSchoolClasses.map(c => `
    <option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>
  `).join('');

  if (allSchoolClasses.length > 0) {
    selectedConfigClassId = allSchoolClasses[0].id;
    await renderClassSubjectsForm();
  }
}

async function renderClassSubjectsForm() {
  const container = document.getElementById('class-subjects-list');
  if (!container || !selectedConfigClassId) return;

  try {
    let subjects = [
      { name: 'English', maxMarks: 100, passMarks: 33 },
      { name: 'Mathematics', maxMarks: 100, passMarks: 33 },
      { name: 'Science', maxMarks: 100, passMarks: 33 },
      { name: 'Urdu', maxMarks: 100, passMarks: 33 },
      { name: 'Islamiat', maxMarks: 50, passMarks: 17 }
    ];

    if (classSubjectsCache[selectedConfigClassId]) {
      subjects = classSubjectsCache[selectedConfigClassId];
    } else {
      const snap = await getDoc(doc(db, 'classSubjects', selectedConfigClassId));
      if (snap.exists() && snap.data().subjects) {
        subjects = snap.data().subjects;
      }
      classSubjectsCache[selectedConfigClassId] = subjects;
    }

    container.innerHTML = subjects.map((s, idx) => `
      <div class="flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-200 subject-row">
        <input type="text" name="sub_name" value="${escapeHTML(s.name)}" required placeholder="Subject Name"
               class="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold outline-none">
        <input type="number" name="sub_max" value="${Number(s.maxMarks) || 100}" min="1" max="1000" required placeholder="Max Marks"
               class="w-24 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-center outline-none">
        <input type="number" name="sub_pass" value="${Number(s.passMarks) || Math.round((Number(s.maxMarks) || 100) * 0.33)}" min="1" required placeholder="Passing"
               class="w-24 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-center outline-none">
        <button type="button" onclick="window.removeSubjectRow(this)" 
                class="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error rendering subject form:', error);
  }
}

window.addSubjectRow = function() {
  const container = document.getElementById('class-subjects-list');
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-200 subject-row';
  div.innerHTML = `
    <input type="text" name="sub_name" value="" required placeholder="New Subject Name"
               class="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold outline-none">
    <input type="number" name="sub_max" value="100" min="1" max="1000" required placeholder="Max Marks"
           class="w-24 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-center outline-none">
    <input type="number" name="sub_pass" value="33" min="1" required placeholder="Passing"
           class="w-24 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-center outline-none">
    <button type="button" onclick="window.removeSubjectRow(this)" 
            class="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
    </button>
  `;
  container.appendChild(div);
};

window.removeSubjectRow = function(btn) {
  const row = btn.closest('.subject-row');
  if (row) row.remove();
};

async function handleSaveClassSubjects(e) {
  e.preventDefault();
  if (!selectedConfigClassId) return;

  const container = document.getElementById('class-subjects-list');
  const rows = container.querySelectorAll('.subject-row');
  const subjects = [];

  rows.forEach(r => {
    const name = r.querySelector('input[name="sub_name"]').value.trim();
    const max = Number(r.querySelector('input[name="sub_max"]').value) || 100;
    const pass = Number(r.querySelector('input[name="sub_pass"]').value) || Math.round(max * 0.33);
    if (name) {
      subjects.push({ name, maxMarks: max, passMarks: pass });
    }
  });

  try {
    await setDoc(doc(db, 'classSubjects', selectedConfigClassId), {
      classId: selectedConfigClassId,
      subjects,
      updatedAt: serverTimestamp()
    }, { merge: true });

    classSubjectsCache[selectedConfigClassId] = subjects;
    showToast('Class subjects curriculum saved successfully!', 'success');
  } catch (error) {
    console.error('Error saving class subjects:', error);
    showToast('Failed to save subjects: ' + error.message, 'error');
  }
}

/* =====================================================================
   7. PARENT ACCOUNTS & MULTI-CHILD LINKING
   ===================================================================== */

function setupParentManagementListeners() {
  const formAddParent = document.getElementById('form-add-parent');
  const classFilter = document.getElementById('parent-link-class-filter');

  if (formAddParent) {
    formAddParent.addEventListener('submit', handleAddParent);
  }

  if (classFilter) {
    classFilter.addEventListener('change', filterStudentsForParentLinking);
  }
}

function renderParentAccountsList(parents) {
  const container = document.getElementById('parents-list-container');
  if (!container) return;

  if (parents.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
        No parent accounts registered yet. Use the form above to add a parent.
      </div>
    `;
    return;
  }

  container.innerHTML = parents.map(p => {
    const studentBadges = (p.linkedStudents || []).map(stdId => {
      return `<span class="px-2 py-0.5 rounded-lg text-xs bg-emerald-50 text-emerald-800 font-bold border border-emerald-100">${escapeHTML(stdId)}</span>`;
    });

    return `
      <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div class="font-bold text-slate-900 text-base flex items-center gap-2">
            ${escapeHTML(p.name)}
            <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 font-bold">Parent</span>
          </div>
          <div class="text-xs text-slate-500 mt-0.5 font-mono">
            Login ID: <strong class="text-slate-800">${escapeHTML((p.email || '').replace('@school.local', ''))}</strong> (${escapeHTML(p.email)}) 
            ${p.phone ? `• 📞 ${escapeHTML(p.phone)}` : ''} • UID: <span class="bg-slate-100 px-1 py-0.5 rounded text-[10px]">${escapeHTML(p.id)}</span>
          </div>
          <div class="mt-2.5 flex flex-wrap gap-1.5 items-center">
            <span class="text-[10px] font-bold text-slate-400 uppercase">Linked Children:</span>
            ${studentBadges.length > 0 ? studentBadges.join('') : `<span class="text-xs text-amber-600 font-medium">None</span>`}
          </div>
        </div>
        <div>
          <button onclick="window.deleteParentPrompt('${escapeHTML(p.id)}', this.dataset.name)"
                  data-name="${escapeHTML(p.name)}"
                  class="px-3 py-1.5 rounded-xl border border-rose-200 hover:bg-rose-50 text-xs font-semibold text-rose-600 transition">
            Remove Account
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function loadParentAccountsList(forceRefresh = false) {
  const container = document.getElementById('parents-list-container');
  if (!container) return;

  if (!forceRefresh && cachedParentsList) {
    renderParentAccountsList(cachedParentsList);
    return;
  }

  try {
    const q = query(collection(db, 'users'), where('role', '==', 'parent'));
    const snap = await getDocs(q);
    const parents = [];
    snap.forEach(d => parents.push({ id: d.id, ...d.data() }));
    cachedParentsList = parents;

    renderParentAccountsList(parents);
  } catch (error) {
    console.error('Error loading parents:', error);
    showToast('Failed to load parent accounts: ' + error.message, 'error');
  }
}

async function loadParentStudentSelector() {
  const classFilter = document.getElementById('parent-link-class-filter');
  if (!classFilter) return;

  classFilter.innerHTML = allSchoolClasses.map(c => `
    <option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>
  `).join('');

  if (allSchoolClasses.length > 0) {
    classFilter.value = allSchoolClasses[0].id;
  }

  await filterStudentsForParentLinking();
}

async function filterStudentsForParentLinking() {
  const classFilter = document.getElementById('parent-link-class-filter');
  const container = document.getElementById('parent-student-checkboxes');
  let selectedClass = classFilter ? classFilter.value : '';

  if (!container) return;

  // Default to first class if none selected, avoiding unfiltered school-wide read of 1,300+ students!
  if (!selectedClass && allSchoolClasses.length > 0) {
    selectedClass = allSchoolClasses[0].id;
    if (classFilter) classFilter.value = selectedClass;
  }

  if (!selectedClass) {
    container.innerHTML = `<div class="col-span-full text-xs text-slate-400 p-2">Select a class above to link students.</div>`;
    return;
  }

  container.innerHTML = `<div class="col-span-full text-xs text-slate-400 p-2">Loading students...</div>`;

  try {
    let students = [];
    if (classStudentsCache[selectedClass]) {
      students = [...classStudentsCache[selectedClass]];
    } else {
      const q = query(collection(db, 'students'), where('classId', '==', selectedClass), where('status', '==', 'active'));
      const snap = await getDocs(q);
      snap.forEach(d => students.push({ id: d.id, ...d.data() }));
      students.sort((a, b) => {
        const numA = parseInt(a.rollNo, 10);
        const numB = parseInt(b.rollNo, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a.rollNo).localeCompare(String(b.rollNo));
      });
      classStudentsCache[selectedClass] = [...students];
    }

    parentSelectorStudents = students;

    if (parentSelectorStudents.length === 0) {
      container.innerHTML = `<div class="col-span-full text-xs text-slate-400 p-2">No students found for this class.</div>`;
      return;
    }

    container.innerHTML = parentSelectorStudents.map(s => `
      <label class="flex items-center gap-2 p-2 bg-slate-50 hover:bg-slate-100 rounded-xl cursor-pointer text-xs font-medium text-slate-700 border border-slate-200">
        <input type="checkbox" name="linkStudent" value="${escapeHTML(s.id)}" data-class="${escapeHTML(s.classId)}" class="rounded text-indigo-600 focus:ring-indigo-500">
        <span><strong>${escapeHTML(s.rollNo)}</strong>. ${escapeHTML(s.name)} <span class="text-[10px] text-slate-400">(${escapeHTML(s.classId)})</span></span>
      </label>
    `).join('');
  } catch (error) {
    console.error('Error loading students for linking:', error);
    container.innerHTML = `<div class="col-span-full text-xs text-rose-500 p-2">Error loading students.</div>`;
  }
}

async function handleAddParent(e) {
  e.preventDefault();
  const nameInput = document.getElementById('parent-name');
  const idInput = document.getElementById('parent-login-id');
  const uidInput = document.getElementById('parent-uid');
  const phoneInput = document.getElementById('parent-phone');
  const selectedBoxes = document.querySelectorAll('input[name="linkStudent"]:checked');

  const name = nameInput.value.trim();
  const rawId = idInput.value.trim();
  const uid = uidInput.value.trim();
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const selectedStudentIds = Array.from(selectedBoxes).map(b => b.value);
  const selectedClasses = Array.from(selectedBoxes).map(b => b.getAttribute('data-class')).filter(Boolean);

  if (!name || !rawId || !uid) {
    showToast('Name, Login ID, and Firebase Auth UID are required.', 'warning');
    return;
  }

  if (selectedStudentIds.length === 0) {
    showToast('Please select at least one child to link to this parent account.', 'warning');
    return;
  }

  const email = normalizeLoginIdentifier(rawId);

  try {
    await setDoc(doc(db, 'users', uid), {
      uid,
      name,
      email,
      phone,
      role: 'parent',
      linkedStudents: selectedStudentIds,
      linkedClasses: Array.from(new Set(selectedClasses)),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    showToast(`Parent account for "${name}" registered with ${selectedStudentIds.length} linked child(ren)!`, 'success');
    nameInput.value = '';
    idInput.value = '';
    uidInput.value = '';
    if (phoneInput) phoneInput.value = '';
    selectedBoxes.forEach(b => b.checked = false);

    cachedParentsList = null;
    await loadParentAccountsList(true);
  } catch (error) {
    console.error('Error creating parent account:', error);
    showToast('Failed to create parent account: ' + error.message, 'error');
  }
}

window.deleteParentPrompt = async function(parentId, parentName) {
  const displayName = parentName || 'this parent';
  if (!confirm(`Are you sure you want to remove the parent account for "${displayName}"?`)) return;

  try {
    await deleteDoc(doc(db, 'users', parentId));
    showToast(`Parent account "${displayName}" removed.`, 'info');
    cachedParentsList = null;
    await loadParentAccountsList(true);
  } catch (error) {
    console.error('Error deleting parent:', error);
    showToast('Failed to remove parent: ' + error.message, 'error');
  }
};
