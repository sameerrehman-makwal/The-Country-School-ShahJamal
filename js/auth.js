/**
 * Authentication & Role Authorization Manager
 * The Country School ShahJamal Attendance System
 */

import { auth, db, isFirebaseConfigured } from './firebase-config.js?v=1.0.1';
import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  getDocs, 
  limit, 
  query 
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { showToast, normalizeLoginIdentifier } from './utils.js';

let currentUserProfile = null;
let onAuthSuccessCallback = null;

export function getCurrentUser() {
  return currentUserProfile;
}

export function initAuth(onAuthSuccess) {
  onAuthSuccessCallback = onAuthSuccess;

  // Setup DOM Event Listeners for Login & Logout
  const loginForm = document.getElementById('login-form');
  const logoutBtn = document.getElementById('btn-logout');
  const bootstrapBtn = document.getElementById('btn-bootstrap-admin');

  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }

  if (bootstrapBtn) {
    bootstrapBtn.addEventListener('click', handleBootstrapAdmin);
  }

  // Monitor Authentication State
  onAuthStateChanged(auth, async (user) => {
    const loadingScreen = document.getElementById('app-loading');
    if (loadingScreen) loadingScreen.classList.add('hidden');

    if (!user) {
      currentUserProfile = null;
      renderUnauthenticatedView();
      return;
    }

    try {
      // Fetch user profile from Firestore users/{uid}
      const userDocRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userDocRef);

      if (userSnap.exists()) {
        currentUserProfile = {
          uid: user.uid,
          email: user.email,
          ...userSnap.data()
        };
        renderAuthenticatedView(currentUserProfile);
        if (typeof onAuthSuccessCallback === 'function') {
          onAuthSuccessCallback(currentUserProfile);
        }
      } else {
        // If user is authenticated in Firebase Auth but has no Firestore profile doc,
        // check if this is the very first user (allow self-registering as first admin)
        handleMissingUserProfile(user);
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
      showToast('Failed to load user permissions: ' + error.message, 'error');
      renderUnauthenticatedView();
    }
  });

  // Check if Firebase config has been filled
  checkConfigBanner();
}

/**
 * Warns if template placeholder keys are still in firebase-config.js
 */
function checkConfigBanner() {
  const configWarning = document.getElementById('firebase-config-warning');
  if (configWarning) {
    if (!isFirebaseConfigured()) {
      configWarning.classList.remove('hidden');
    } else {
      configWarning.classList.add('hidden');
    }
  }
}

/**
 * Handle Email/Password Login
 */
async function handleLogin(e) {
  e.preventDefault();
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const loginBtn = document.getElementById('btn-login-submit');

  const rawInput = emailInput.value.trim();
  const password = passwordInput.value;

  if (!rawInput || !password) {
    showToast('Please enter both ID/Email and password.', 'warning');
    return;
  }

  // Normalize: If parent/student enters "1001" or "P-1001", map to "1001@school.local"
  const email = normalizeLoginIdentifier(rawInput);

  try {
    loginBtn.disabled = true;
    loginBtn.innerHTML = `
      <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg> Signing in...`;

    await signInWithEmailAndPassword(auth, email, password);
    showToast('Signed in successfully!', 'success');
  } catch (error) {
    console.error('Login error:', error);
    let msg = 'Authentication failed. Please check your credentials.';
    if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
      msg = 'Invalid email or password.';
    } else if (error.code === 'auth/network-request-failed') {
      msg = 'Network error. Please check your internet connection.';
    } else if (error.code === 'auth/too-many-requests') {
      msg = 'Too many failed login attempts. Please try again later.';
    }
    showToast(msg, 'error');
  } finally {
    loginBtn.disabled = false;
    loginBtn.innerHTML = `Sign In to Portal`;
  }
}

/**
 * Handle Logout
 */
export async function handleLogout() {
  try {
    await signOut(auth);
    currentUserProfile = null;
    showToast('Signed out successfully.', 'info');
    renderUnauthenticatedView();
  } catch (error) {
    console.error('Logout error:', error);
    showToast('Error signing out.', 'error');
  }
}

/**
 * Handles when a user authenticated with Firebase Auth lacks a Firestore profile
 */
async function handleMissingUserProfile(authUser) {
  try {
    // Check if any users exist in the users collection
    const usersCol = collection(db, 'users');
    const existingUsersSnap = await getDocs(query(usersCol, limit(1)));

    if (existingUsersSnap.empty) {
      // First user ever in the database -> prompt to bootstrap as First Admin
      const bootstrapCard = document.getElementById('bootstrap-admin-card');
      if (bootstrapCard) {
        document.getElementById('bootstrap-user-email').textContent = authUser.email;
        bootstrapCard.classList.remove('hidden');
        document.getElementById('view-login').classList.add('hidden');
        return;
      }
    }

    // Otherwise account is not registered by Admin
    showToast('Your account has no assigned school role. Please contact an Administrator.', 'error');
    await signOut(auth);
    renderUnauthenticatedView();
  } catch (err) {
    console.error('Check users error:', err);
    showToast('Access denied: Unauthorized profile.', 'error');
    await signOut(auth);
    renderUnauthenticatedView();
  }
}

/**
 * Creates the initial Admin user profile when setting up a fresh database
 */
async function handleBootstrapAdmin() {
  const user = auth.currentUser;
  if (!user) return;

  const nameInput = document.getElementById('bootstrap-name');
  const name = nameInput ? nameInput.value.trim() : 'System Administrator';

  try {
    const adminDoc = {
      uid: user.uid,
      email: user.email,
      name: name || 'System Administrator',
      role: 'admin',
      assignedClassIds: [],
      createdAt: new Date().toISOString()
    };

    await setDoc(doc(db, 'users', user.uid), adminDoc, { merge: true });
    document.getElementById('bootstrap-admin-card').classList.add('hidden');
    showToast('First Administrator profile initialized!', 'success');

    currentUserProfile = adminDoc;
    renderAuthenticatedView(currentUserProfile);
    if (typeof onAuthSuccessCallback === 'function') {
      onAuthSuccessCallback(currentUserProfile);
    }
  } catch (error) {
    console.error('Error bootstrapping admin:', error);
    showToast('Failed to create admin profile: ' + error.message, 'error');
  }
}

/**
 * Updates UI for Unauthenticated State (Shows Login Screen)
 */
function renderUnauthenticatedView() {
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('view-admin').classList.add('hidden');
  document.getElementById('view-teacher').classList.add('hidden');
  const parentView = document.getElementById('view-parent');
  if (parentView) parentView.classList.add('hidden');
  document.getElementById('user-header-profile').classList.add('hidden');
  document.getElementById('btn-logout').classList.add('hidden');
}

/**
 * Updates UI for Authenticated State (Switches to Admin, Teacher, or Parent View)
 */
function renderAuthenticatedView(user) {
  document.getElementById('view-login').classList.add('hidden');
  const bootstrapCard = document.getElementById('bootstrap-admin-card');
  if (bootstrapCard) bootstrapCard.classList.add('hidden');

  // Display user details in header
  const headerProfile = document.getElementById('user-header-profile');
  const headerUserName = document.getElementById('header-user-name');
  const headerUserRole = document.getElementById('header-user-role');
  const logoutBtn = document.getElementById('btn-logout');

  if (headerProfile && headerUserName && headerUserRole) {
    const roleLabels = {
      admin: 'Administrator',
      teacher: 'Teacher',
      parent: 'Parent / Guardian'
    };
    const roleStyles = {
      admin: 'text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800',
      teacher: 'text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800',
      parent: 'text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800'
    };

    headerUserName.textContent = user.name || user.email;
    headerUserRole.textContent = roleLabels[user.role] || user.role;
    headerUserRole.className = roleStyles[user.role] || 'text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-800';
    headerProfile.classList.remove('hidden');
  }

  if (logoutBtn) logoutBtn.classList.remove('hidden');

  const viewAdmin = document.getElementById('view-admin');
  const viewTeacher = document.getElementById('view-teacher');
  const viewParent = document.getElementById('view-parent');

  if (viewAdmin) viewAdmin.classList.add('hidden');
  if (viewTeacher) viewTeacher.classList.add('hidden');
  if (viewParent) viewParent.classList.add('hidden');

  if (user.role === 'admin' && viewAdmin) {
    viewAdmin.classList.remove('hidden');
  } else if (user.role === 'teacher' && viewTeacher) {
    viewTeacher.classList.remove('hidden');
  } else if (user.role === 'parent' && viewParent) {
    viewParent.classList.remove('hidden');
  }
}
