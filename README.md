# The Country School ShahJamal — Attendance & Examination Management System

A production-grade, zero-cost School Attendance & Examination Management System designed for up to **1,300+ students**, built with **HTML5, Tailwind CSS, Vanilla JavaScript (ES Modules), Firebase Authentication, and Cloud Firestore**.

---

## 🌟 Zero-Cost & Scale Highlights (100% Spark Free Plan)

This application is strictly architected to operate within Firebase's free **Spark Plan** and hostable for free on **GitHub Pages**:
- **0.2% Daily Write Quota Usage for Attendance:** Daily attendance is aggregated into one document per class per day (`attendance/{classId}_{YYYY-MM-DD}`) instead of one document per student. The entire school of 1,300 students consumes only **~35 document writes per day** (out of 20,000 free writes daily).
- **Single-Document Report Card Architecture:** Each student's full examination record (all subjects, marks, totals, percentages, grade, remarks) is packed into **one document** (`results/{studentId}_{termId}`). When 1,300 parents check results on result day, it requires only **1,300 reads total** (only 2.6% of the 50,000 free daily reads).
- **Zero-Cost Parent Authentication (SMS/Phone Gateway Bypass):** Parents log in with their Student/Parent ID (e.g. `1001` or `P-1001`), which is silently normalized to `1001@school.local` under Firebase Email/Password Auth, completely bypassing paid SMS verification.
- **Multi-Child Linking & Child Switcher:** Parents with multiple children enrolled in different classes can switch between siblings with a single tap to view individual attendance metrics and report cards.
- **Zero-Cost PDF Report Card Generation:** Clean `@media print` CSS formats official A4 student report cards for one-click printing or "Save as PDF" directly from the browser without paid serverless PDF generators.
- **Offline Resilience:** Configured with modern Firebase v10 `persistentLocalCache` (IndexedDB). Teachers can mark attendance without interruptions if school Wi-Fi drops.
- **Strict Role-Based Anti-Tampering:**
  - Teachers can only mark attendance for **Today's date** and only for their **assigned classes**.
  - Teachers enter marks only while an Exam Term is in **Draft** status. Once published by Admin, marks are permanently locked for teachers.
  - Parents have strictly read-only access and can **ONLY** access records for student IDs explicitly linked in their own profile (`linkedStudents`), and can **ONLY** read results marked as **Published**.

---

## 📁 Project Structure

```
The Country School ShahJamal/
│
├── index.html                   # Single-page application layout & responsive UI
├── css/
│   └── custom.css               # Print media stylesheets (@media print) & A4 report cards
├── js/
│   ├── firebase-config.js       # Firebase SDK v10 init + IndexedDB offline cache setup
│   ├── auth.js                  # Authentication, session manager, ID mapping & role routing
│   ├── parent.js                # Parent portal: child switcher, attendance card & report card
│   ├── teacher.js               # Teacher portal: roll call, P/A/L/E toggles, WhatsApp & marks entry
│   ├── admin.js                 # Admin panel: terms, subjects, CSV import, teachers, parents, reports
│   └── utils.js                 # Grading engine, WhatsApp builder, CSV parser/exporter, toasts
├── firestore.rules              # Granular role-based security & anti-tampering rules
├── sample_students_grade10a.csv # 35-student test dataset for bulk CSV importer
└── README.md                    # Setup, deployment, operational, and security guide
```

---

## 🚀 Step-by-Step Setup Guide

### Step 1: Create a Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/) and click **Add Project**.
2. Name your project (e.g., `Country-School-ShahJamal`).
3. You can disable Google Analytics (optional) and click **Create Project**.

### Step 2: Enable Firebase Authentication
1. In the Firebase Console left sidebar, click **Build > Authentication**.
2. Click **Get Started**, choose **Email/Password** from the Sign-in providers, and enable it.
3. Click **Save**.

### Step 3: Create Cloud Firestore Database
1. In the left sidebar, click **Build > Firestore Database**.
2. Click **Create Database**.
3. Choose a server location closest to your users (e.g., `asia-south1` or `eur3`).
4. Select **Start in production mode** and click **Create**.

### Step 4: Deploy Firestore Security Rules
1. In Firestore Database, click the **Rules** tab at the top.
2. Copy the entire contents of `firestore.rules` from this repository.
3. Paste it into the editor and click **Publish**.

### Step 5: Add Web App & Connect Credentials
1. In Firebase Console, click the Gear icon ⚙️ (Project Settings) > **General**.
2. Scroll down to **Your apps** and click the Web **`</>`** icon.
3. Register your app as `The Country School Portal`.
4. Copy the `firebaseConfig` object and paste it into `js/firebase-config.js`:
   ```javascript
   export const firebaseConfig = {
     apiKey: "YOUR_ACTUAL_API_KEY",
     authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_PROJECT_ID.appspot.com",
     messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```

### Step 6: Create the Master Administrator Account
1. Open `index.html` in your browser.
2. In Firebase Console > **Authentication > Users**, click **Add user** and create your admin account (e.g. `admin@countryschool.edu` and a secure password).
3. In the application login screen, sign in with this new account.
4. The system detects the initial setup and displays: **"Fresh Setup Detected: Initialize First Administrator"**.
5. Enter the Administrator's Name and click **Initialize Master Administrator Profile**.

### Step 7: Free Hosting on GitHub Pages
1. Push this repository to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of School Attendance & Exam System"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/country-school-attendance.git
   git push -u origin main
   ```
2. On GitHub, navigate to **Settings > Pages**.
3. Under **Build and deployment > Source**, select **Deploy from a branch** (`main` branch, `/ (root)` folder) and click **Save**.
4. Your application will be live at `https://YOUR_USERNAME.github.io/country-school-attendance/`!

---

## 📋 Operational Walkthrough

### 👨‍💼 1. Administrator Flow
1. **Create Classes:**
   - Go to **Classes** tab -> Add Grade, Section, Academic Year.
2. **Import Students:**
   - Go to **Students & CSV Import** tab -> Choose target class -> Upload `sample_students_grade10a.csv` -> Click **Confirm & Import to Firestore**.
3. **Register Teacher Accounts:**
   - In Firebase Console > Auth, create user (e.g. `teacher@countryschool.edu`) and copy the User UID.
   - In Admin Portal > **Teacher Profiles**, enter Name, Email, paste UID, and check assigned classes.
4. **Create Exam Terms & Configure Subjects:**
   - Go to **Exam Terms & Subjects** tab.
   - Enter Term Name (e.g. `Mid-Term Examination 2026`) and click **+ Create Exam Term (Draft)**.
   - Under **Class Subjects Curriculum**, choose a class and adjust subject names, max marks, and pass marks (e.g. English: 100, Mathematics: 100, Islamiat: 50).
5. **Register Parent Accounts & Link Children:**
   - In Firebase Console > Auth, add a parent user with email `1001@school.local` (or child's roll number) and a password (e.g. `ParentPass123!`), then copy the UID.
   - In Admin Portal > **Parent Accounts**, enter:
     - **Parent Full Name:** e.g. `Mr. Tariq Mahmood`
     - **Parent / Student ID:** `1001`
     - **Firebase Auth UID:** Paste the copied UID.
     - **Select Children to Link:** Check Roll 1001 (Muhammad Ali) and any siblings.
     - Click **+ Save Parent Account**.
6. **Publishing Exam Results:**
   - Once teachers finish entering marks, go to **Exam Terms & Subjects** and click **Publish Results**.
   - This automatically updates all results to `status: "published"`, unlocking them for parents.

---

### 👩‍🏫 2. Teacher Flow
1. **Attendance Roll Call:**
   - Select assigned class -> Click **Mark All Present** -> Tap individual student badges `[ P ]`, `[ A ]`, `[ L ]`, `[ E ]`.
   - Click **Save Attendance** (syncs to Firestore or IndexedDB if offline).
   - Tapping **Notify Parent** on absent students generates a pre-formatted WhatsApp alert (`https://wa.me/...`).
2. **Exam Marks Entry:**
   - Switch to **Exam Marks Entry** tab.
   - Select the Exam Term (must be in `Draft` mode) and assigned class.
   - Enter marks per subject. Total marks, percentage, and letter grade (`A+`, `A`, `B`, `C`, `D`, `F`) update in real-time.
   - Click **Save All Marks**.
   - *Protection Notice:* Once Administration sets a term to `Published`, the interface displays a lock banner and disables editing.

---

### 👨‍👩‍👧 3. Parent Portal Flow
1. **Log In:**
   - On the login screen, enter Student ID (e.g. `1001`) and password.
   - The system automatically maps this to `1001@school.local` for seamless sign in.
2. **Sibling Switcher:**
   - If the parent has multiple children linked, click the child's name tab at the top to toggle between siblings.
3. **Attendance Summary:**
   - View cumulative working days, present, absent, and late counts with an overall attendance percentage.
   - A warning alert appears if attendance drops below 75%.
4. **Examination Report Card:**
   - Select the published term from the dropdown.
   - Displays the formal report card with subject breakdown, maximum marks, passing marks, obtained marks, subject grades, grand total, percentage, overall grade, and teacher remarks.
5. **Print / Save as PDF:**
   - Click **Print / Save PDF Report Card** to open the browser print dialog. Clean `@media print` styles produce an official A4 document with school crest, watermark, and signature lines.

---

## 🔒 Security Boundary & Privacy Verification

| Collection | Parent Access Boundary | Anti-Tampering Guarantee |
|---|---|---|
| `users/{uid}` | Can **ONLY** read (`get`) their own user document. Cannot list other users. | Roles cannot be modified by non-admin users. |
| `students/{id}` | Can **ONLY** read student documents whose ID is in `users/{uid}.linkedStudents`. | Cannot read other families' student profiles. |
| `results/{id}` | Can **ONLY** read results where `studentId in linkedStudents` **AND** `status == "published"`. | Strictly forbidden from viewing draft results before official release. |
| `attendance/{id}` | Can **ONLY** read attendance documents for classes where their children study (`classId in linkedClasses`). | Teachers cannot edit past dates. |
