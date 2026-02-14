// Course Scheduler Application
// Real-time drag-and-drop scheduling with WebSocket sync

class CourseScheduler {
    constructor() {
        this.socket = null;
        this.scheduleData = { courses: [], instructors: [], timeSlots: {} };
        this.courseHistory = {}; // Historical course offerings
        this.selectedFaculty = '';
        this.currentTerm = 'fall-2026';
        this.currentCourseId = null;
        this.pendingSlotId = null; // For double-click to add course
        this.actionHistory = []; // Track all actions for undo
        this.historyPanelOpen = false;

        // Slot ID to human-readable schedule mapping
        this.slotLabels = {
            'MW-A': 'Mon/Wed 8:15-9:40',
            'MW-B': 'Mon/Wed 9:50-11:15',
            'MW-C': 'Mon/Wed 11:30-12:55',
            'MW-D': 'Mon/Wed 1:05-2:30',
            'MW-E': 'Mon/Wed 2:40-4:05',
            'TR-G': 'Tue/Thu 8:15-9:40',
            'TR-H': 'Tue/Thu 9:50-11:15',
            'TR-I': 'Tue/Thu 11:25-12:50',
            'TR-J': 'Tue/Thu 2:00-3:25',
            'TR-K': 'Tue/Thu 3:35-5:00',
            'M-EVE': 'Monday 6:15-9:00pm',
            'T-EVE': 'Tuesday 6:15-9:00pm',
            'W-EVE': 'Wednesday 6:15-9:00pm',
            'TR-EVE': 'Thursday 6:15-9:00pm',
            'SAT': 'Saturday',
            'ASYNCH': 'Online Asynchronous'
        };

        // Known rooms
        this.rooms = [
            'HT 113', 'HT 114',
            'ONLINE ASYNCH', 'ONLINE SYNCHR',
            'RO 23', 'RO 30', 'RO 31', 'RO 101', 'RO 119', 'RO 120',
            'RO 123', 'RO 212', 'RO 215', 'RO 218', 'RO 223',
            'TA 107', 'TA 207'
        ];

        this.init();
    }

    async init() {
        // Check URL parameters for term and faculty
        this.parseUrlParameters();

        await this.loadSchedule();
        await this.loadCourseHistory();
        this.initSocket();
        this.setupEventListeners();
        this.renderCourseList();
        this.renderScheduleGrid();
        this.populateFacultyDropdown();
        this.updateFacultyPanel();
        this.updateTermDisplay();
    }

    // Parse URL parameters for shareable links
    parseUrlParameters() {
        const params = new URLSearchParams(window.location.search);
        const term = params.get('term');
        const faculty = params.get('faculty');

        if (term && ['fall-2026', 'spring-2027'].includes(term)) {
            this.currentTerm = term;
        }
        if (faculty) {
            this.selectedFaculty = decodeURIComponent(faculty);
        }
    }

    // Update the term dropdown display
    updateTermDisplay() {
        const termDropdown = document.getElementById('termDropdown');
        if (termDropdown) {
            termDropdown.value = this.currentTerm;
        }
        // Update header title
        const termLabel = this.currentTerm === 'fall-2026' ? 'Fall 2026' : 'Spring 2027';
        const titleSection = document.querySelector('.title-section h2');
        if (titleSection) {
            titleSection.textContent = `${termLabel} Course Schedule`;
        }
    }

    // Load schedule data from server
    async loadSchedule() {
        try {
            const response = await fetch(`/api/schedule?term=${this.currentTerm}`);
            this.scheduleData = await response.json();
        } catch (error) {
            console.error('Failed to load schedule:', error);
            this.showToast('Failed to load schedule', 'error');
        }
    }

    // Switch to a different term
    async switchTerm(newTerm) {
        this.currentTerm = newTerm;
        this.actionHistory = []; // Clear undo history when switching terms
        await this.loadSchedule();
        this.renderCourseList();
        this.renderScheduleGrid();
        this.highlightFacultyCourses();
        this.updateFacultyPanel();
        this.updateTermDisplay();
        this.updateUndoButton();
        this.renderHistoryPanel();
        this.updateShareableUrl();
        this.showToast(`Switched to ${newTerm === 'fall-2026' ? 'Fall 2026' : 'Spring 2027'}`, 'info');
    }

    // Load course history data
    async loadCourseHistory() {
        try {
            const response = await fetch('/api/course-history');
            this.courseHistory = await response.json();
        } catch (error) {
            console.error('Failed to load course history:', error);
        }
    }

    // Initialize WebSocket connection
    initSocket() {
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.updateConnectionStatus(true);
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.updateConnectionStatus(false);
        });

        this.socket.on('connected', (data) => {
            console.log('Connection confirmed:', data);
        });

        this.socket.on('schedule_update', (data) => {
            console.log('Schedule update received:', data);
            // Only apply if for current term
            if (!data.term || data.term === this.currentTerm) {
                this.handleScheduleUpdate(data);
            }
        });

        this.socket.on('course_update', (data) => {
            console.log('Course update received:', data);
            if (!data.term || data.term === this.currentTerm) {
                this.handleCourseUpdate(data);
            }
        });

        this.socket.on('full_sync', (data) => {
            console.log('Full sync received');
            if (!data.term || data.term === this.currentTerm) {
                this.scheduleData = data;
                this.renderCourseList();
                this.renderScheduleGrid();
                this.updateFacultyPanel();
            }
        });

        this.socket.on('course_added', (data) => {
            console.log('Course added:', data);
            if (!data.term || data.term === this.currentTerm) {
                this.scheduleData.courses.push(data.course);
                this.renderCourseList();
                this.renderScheduleGrid();
                this.populateFacultyDropdown();
                this.updateFacultyPanel();
            }
        });

        this.socket.on('faculty_added', (data) => {
            console.log('Faculty added:', data);
            if (!data.term || data.term === this.currentTerm) {
                if (!this.scheduleData.faculty) {
                    this.scheduleData.faculty = [];
                }
                if (!this.scheduleData.faculty.includes(data.name)) {
                    this.scheduleData.faculty.push(data.name);
                    this.scheduleData.faculty.sort();
                }
                this.populateFacultyDropdown();
                this.renderFacultyList();
            }
        });

        this.socket.on('faculty_deleted', (data) => {
            console.log('Faculty deleted:', data);
            if (!data.term || data.term === this.currentTerm) {
                if (this.scheduleData.faculty) {
                    this.scheduleData.faculty = this.scheduleData.faculty.filter(f => f !== data.name);
                }
                this.populateFacultyDropdown();
                this.renderFacultyList();
            }
        });

        this.socket.on('course_deleted', (data) => {
            console.log('Course deleted:', data);
            if (!data.term || data.term === this.currentTerm) {
                this.scheduleData.courses = this.scheduleData.courses.filter(c => c.id !== data.courseId);
                this.renderCourseList();
                this.renderScheduleGrid();
                this.updateFacultyPanel();
            }
        });

        this.socket.on('data_restored', (data) => {
            console.log('Data restored:', data);
            this.showToast('Data has been restored. Reloading...', 'success');
            setTimeout(() => window.location.reload(), 1500);
        });
    }

    updateConnectionStatus(connected) {
        const statusEl = document.getElementById('connectionStatus');
        const dot = statusEl.querySelector('.status-dot');
        const text = statusEl.querySelector('.status-text');

        dot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
        text.textContent = connected ? 'Connected' : 'Disconnected';
    }

    // Setup event listeners
    setupEventListeners() {
        // Term dropdown
        document.getElementById('termDropdown').addEventListener('change', (e) => {
            this.switchTerm(e.target.value);
        });

        // Faculty dropdown
        document.getElementById('facultyDropdown').addEventListener('change', (e) => {
            this.selectedFaculty = e.target.value;
            this.highlightFacultyCourses();
            this.updateFacultyPanel();
            this.updateShareableUrl();
        });

        // Copy share link button
        document.getElementById('copyShareLink').addEventListener('click', () => {
            const linkInput = document.getElementById('facultyShareLink');
            linkInput.select();
            document.execCommand('copy');
            this.showToast('Link copied to clipboard', 'success');
        });

        // Course filter
        document.getElementById('courseFilter').addEventListener('input', (e) => {
            this.filterCourses(e.target.value);
        });

        // Export buttons
        document.getElementById('exportJson').addEventListener('click', () => {
            window.location.href = `/api/export/json?term=${this.currentTerm}`;
        });

        document.getElementById('exportExcel').addEventListener('click', () => {
            window.location.href = `/api/export/excel?term=${this.currentTerm}`;
        });

        // Modal
        document.querySelector('.close-modal').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('saveModal').addEventListener('click', () => {
            this.saveModalChanges();
        });

        document.getElementById('removeCourse').addEventListener('click', () => {
            this.removeCourseFromSchedule();
        });

        // Close modal on outside click
        document.getElementById('courseModal').addEventListener('click', (e) => {
            if (e.target.id === 'courseModal') {
                this.closeModal();
            }
        });

        // Add Course modal
        document.getElementById('addCourseBtn').addEventListener('click', () => {
            this.openAddCourseModal();
        });

        document.getElementById('closeAddModal').addEventListener('click', () => {
            this.closeAddCourseModal();
        });

        document.getElementById('submitAddCourse').addEventListener('click', () => {
            this.submitNewCourse();
        });

        document.getElementById('addCourseModal').addEventListener('click', (e) => {
            if (e.target.id === 'addCourseModal') {
                this.closeAddCourseModal();
            }
        });

        // Faculty Management modal
        document.getElementById('manageFaculty').addEventListener('click', () => {
            this.openFacultyModal();
        });

        document.getElementById('closeFacultyModal').addEventListener('click', () => {
            this.closeFacultyModal();
        });

        document.getElementById('addFacultyBtn').addEventListener('click', () => {
            this.addFaculty();
        });

        document.getElementById('newFacultyName').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addFaculty();
            }
        });

        document.getElementById('facultyModal').addEventListener('click', (e) => {
            if (e.target.id === 'facultyModal') {
                this.closeFacultyModal();
            }
        });

        // Backup and Restore
        document.getElementById('backupAll').addEventListener('click', () => {
            window.location.href = '/api/backup';
        });

        document.getElementById('restoreData').addEventListener('click', () => {
            this.openRestoreModal();
        });

        document.getElementById('closeRestoreModal').addEventListener('click', () => {
            this.closeRestoreModal();
        });

        document.getElementById('submitRestore').addEventListener('click', () => {
            this.submitRestore();
        });

        document.getElementById('restoreModal').addEventListener('click', (e) => {
            if (e.target.id === 'restoreModal') {
                this.closeRestoreModal();
            }
        });

        document.getElementById('passwordHint').addEventListener('click', () => {
            alert('Hint: This is the most prestigious award given by the department');
        });

        // AI Analysis
        document.getElementById('aiRecommend').addEventListener('click', () => {
            this.openAiModal();
        });

        document.getElementById('closeAiModal').addEventListener('click', () => {
            this.closeAiModal();
        });

        document.getElementById('aiModal').addEventListener('click', (e) => {
            if (e.target.id === 'aiModal') {
                this.closeAiModal();
            }
        });

        document.getElementById('runAiAnalysis').addEventListener('click', () => {
            this.runAiAnalysis();
        });

        // Undo and History
        document.getElementById('undoBtn').addEventListener('click', () => {
            this.undo();
        });

        document.getElementById('historyToggle').addEventListener('click', () => {
            this.toggleHistoryPanel();
        });

        document.getElementById('closeHistoryPanel').addEventListener('click', () => {
            this.toggleHistoryPanel();
        });

        // Keyboard shortcut for undo (Ctrl+Z or Cmd+Z)
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.matches('input, textarea')) {
                e.preventDefault();
                this.undo();
            }
        });
    }

    // Populate faculty dropdown and ensure faculty list is initialized
    populateFacultyDropdown() {
        // Build faculty list from stored faculty + instructors from courses
        const facultySet = new Set(this.scheduleData.faculty || []);

        this.scheduleData.courses.forEach(course => {
            if (course.instructor && course.instructor !== 'Faculty' && course.instructor.trim()) {
                facultySet.add(course.instructor);
            }
        });

        // Sort alphabetically
        const sortedFaculty = Array.from(facultySet).sort();

        // Update the filter dropdown
        const dropdown = document.getElementById('facultyDropdown');
        const currentValue = dropdown.value;
        dropdown.innerHTML = '<option value="">All Faculty</option>';
        sortedFaculty.forEach(instructor => {
            const option = document.createElement('option');
            option.value = instructor;
            option.textContent = instructor;
            dropdown.appendChild(option);
        });
        dropdown.value = currentValue;

        // Store sorted faculty back
        this.scheduleData.faculty = sortedFaculty;

        // Restore selected faculty
        if (this.selectedFaculty) {
            dropdown.value = this.selectedFaculty;
        }
    }

    // Update the faculty panel on the right
    updateFacultyPanel() {
        const panel = document.getElementById('facultyPanel');
        const title = document.getElementById('facultyPanelTitle');
        const content = document.getElementById('facultyPanelContent');
        const footer = document.getElementById('facultyPanelFooter');

        if (!this.selectedFaculty) {
            title.textContent = 'Select a Faculty Member';
            content.innerHTML = '<p class="no-faculty-selected">Select a faculty member from the "View as" dropdown to see their schedule.</p>';
            footer.style.display = 'none';
            return;
        }

        title.textContent = this.selectedFaculty;

        // Get courses for this faculty in current term
        const facultyCourses = this.scheduleData.courses.filter(c =>
            c.instructor === this.selectedFaculty
        );

        const termLabel = this.currentTerm === 'fall-2026' ? 'Fall 2026' : 'Spring 2027';

        if (facultyCourses.length === 0) {
            content.innerHTML = `<p class="no-faculty-selected">${this.selectedFaculty} has no courses scheduled for ${termLabel}.</p>`;
        } else {
            // Sort by slot
            const slotOrder = ['MW-A', 'MW-B', 'MW-C', 'MW-D', 'MW-E', 'TR-G', 'TR-H', 'TR-I', 'TR-J', 'TR-K', 'M-EVE', 'T-EVE', 'W-EVE', 'TR-EVE', 'SAT', 'ASYNCH'];
            facultyCourses.sort((a, b) => {
                const aIdx = slotOrder.indexOf(a.slotId) || 99;
                const bIdx = slotOrder.indexOf(b.slotId) || 99;
                return aIdx - bIdx;
            });

            content.innerHTML = `
                <div class="faculty-schedule-header">
                    <strong>${termLabel} Schedule</strong>
                    <span class="course-count">${facultyCourses.length} course${facultyCourses.length !== 1 ? 's' : ''}</span>
                </div>
                ${facultyCourses.map(course => `
                    <div class="faculty-schedule-item" data-course-id="${course.id}">
                        <div class="faculty-course-code">${course.code} ${course.number}-${course.section}</div>
                        <div class="faculty-course-name">${course.name || ''}</div>
                        <div class="faculty-course-time">${course.slotId ? this.slotLabels[course.slotId] : 'Unscheduled'}</div>
                        <div class="faculty-course-room">${course.room || ''}</div>
                    </div>
                `).join('')}
            `;

            // Make items clickable to highlight in grid
            content.querySelectorAll('.faculty-schedule-item').forEach(item => {
                item.addEventListener('click', () => {
                    const courseId = item.dataset.courseId;
                    const scheduled = document.querySelector(`.scheduled-course[data-course-id="${courseId}"]`);
                    if (scheduled) {
                        scheduled.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        scheduled.classList.add('flash-highlight');
                        setTimeout(() => scheduled.classList.remove('flash-highlight'), 1500);
                    }
                });
            });
        }

        // Show footer with shareable link
        footer.style.display = 'block';
        this.updateShareableUrl();
    }

    // Update the shareable URL
    updateShareableUrl() {
        const linkInput = document.getElementById('facultyShareLink');
        if (!linkInput) return;

        const baseUrl = window.location.origin + window.location.pathname;
        const params = new URLSearchParams();
        params.set('term', this.currentTerm);
        if (this.selectedFaculty) {
            params.set('faculty', this.selectedFaculty);
        }
        linkInput.value = `${baseUrl}?${params.toString()}`;
    }

    // Populate instructor dropdown in modals
    populateInstructorDropdown(selectElement, selectedValue = '') {
        selectElement.innerHTML = '<option value="">Select Instructor</option>';
        const faculty = this.scheduleData.faculty || [];
        faculty.forEach(instructor => {
            const option = document.createElement('option');
            option.value = instructor;
            option.textContent = instructor;
            selectElement.appendChild(option);
        });
        selectElement.value = selectedValue;
    }

    // Render course list in sidebar - compact view grouped by department
    renderCourseList() {
        const courseList = document.getElementById('courseList');
        const filterInput = document.getElementById('courseFilter');
        const filterText = filterInput ? filterInput.value.toLowerCase() : '';
        courseList.innerHTML = '';

        // Get unique courses from history, grouped by department
        const coursesByDept = {};
        for (const [courseId, data] of Object.entries(this.courseHistory)) {
            const key = `${data.code} ${data.number}`;
            if (filterText && !key.toLowerCase().includes(filterText) &&
                !data.name.toLowerCase().includes(filterText)) {
                continue;
            }
            if (!coursesByDept[data.code]) {
                coursesByDept[data.code] = [];
            }
            coursesByDept[data.code].push({
                id: courseId,
                code: data.code,
                number: data.number,
                name: data.name,
                description: data.description || '',
                credits: data.credits || '',
                core: data.core || '',
                offered: data.offered || '',
                offerings: data.offerings || []
            });
        }

        // Sort departments and courses
        const deptOrder = ['ECON', 'ECMG', 'MGMT', 'ITMG', 'LEAD', 'CAMG'];
        const sortedDepts = Object.keys(coursesByDept).sort((a, b) => {
            const aIdx = deptOrder.indexOf(a);
            const bIdx = deptOrder.indexOf(b);
            if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
            if (aIdx === -1) return 1;
            if (bIdx === -1) return -1;
            return aIdx - bIdx;
        });

        sortedDepts.forEach(dept => {
            // Department header
            const header = document.createElement('div');
            header.className = 'dept-header';
            header.textContent = dept;
            courseList.appendChild(header);

            // Sort courses by number
            const courses = coursesByDept[dept].sort((a, b) =>
                parseInt(a.number) - parseInt(b.number)
            );

            courses.forEach(course => {
                const item = this.createCourseListItem(course);
                courseList.appendChild(item);
            });
        });
    }

    // Create a compact course list item
    createCourseListItem(course) {
        const item = document.createElement('div');
        item.className = 'course-list-item';
        item.dataset.courseId = course.id;

        // Check if this course is scheduled for current term
        const scheduledSections = this.scheduleData.courses.filter(c =>
            c.code === course.code && c.number === course.number
        );
        const isScheduled = scheduledSections.length > 0;
        const scheduledCount = scheduledSections.filter(s => s.slotId).length;
        const unscheduledSections = scheduledSections.filter(s => !s.slotId);
        const unscheduledCount = unscheduledSections.length;

        let badges = '';
        let isMissing = false;
        let missingReason = '';

        // Check if course should be offered this term but isn't
        const isFallTerm = this.currentTerm === 'fall-2026';
        const shouldBeOffered = this.shouldCourseBeOffered(course, isFallTerm);

        if (shouldBeOffered && !isScheduled) {
            isMissing = true;
            missingReason = this.getMissingReason(course, isFallTerm);
            item.classList.add('missing-course');
            badges += `<span class="course-badge missing" title="${missingReason}">!</span>`;
        }

        // Offering indicator for special schedules
        if (course.offered) {
            const offeredClass = this.getOfferedClass(course.offered);
            if (offeredClass) {
                let label = '';
                if (offeredClass === 'fall-only') label = 'F';
                else if (offeredClass === 'spring-only') label = 'S';
                else if (offeredClass === 'alternate-years') label = 'Alt';
                badges += `<span class="course-badge ${offeredClass}" title="${course.offered}">${label}</span>`;
            }
        }

        // Scheduled status
        if (isScheduled) {
            if (unscheduledCount > 0) {
                badges += `<span class="course-badge unscheduled">${unscheduledCount}</span>`;
            }
            if (scheduledCount > 0) {
                badges += `<span class="course-badge scheduled">${scheduledCount}</span>`;
            }
        }

        item.innerHTML = `
            <span class="course-code-compact">${course.code} ${course.number}</span>
            <span class="course-badges">${badges}</span>
        `;

        // Make draggable if there are unscheduled sections
        if (unscheduledCount > 0) {
            item.draggable = true;
            item.classList.add('draggable');
            item.title = `Drag to schedule ${course.code} ${course.number}`;

            // Store the first unscheduled section ID for dragging
            const firstUnscheduled = unscheduledSections[0];
            item.dataset.unscheduledId = firstUnscheduled.id;

            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', firstUnscheduled.id);
                item.classList.add('dragging');
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
            });
        }

        // Click to show course history
        item.addEventListener('click', (e) => {
            // Don't open modal if we just finished dragging
            if (!item.classList.contains('dragging')) {
                this.openCourseHistoryModal(course);
            }
        });

        return item;
    }

    // Determine if a course should be offered in current term
    shouldCourseBeOffered(course, isFallTerm) {
        if (!course.offered) return false;

        const offered = course.offered.toLowerCase();

        // Both semesters - always should be offered
        if (offered.includes('both') || offered.includes('either')) {
            return true;
        }

        // IMPORTANT: Check alternate years BEFORE checking fall/spring only
        // This handles "Fall Semester (Odd Years)" and similar correctly
        if (offered.includes('odd years') || offered.includes('even years')) {
            const isEvenYear = true; // 2026 is even
            if (offered.includes('even years')) {
                // Even year course - check if it's the right semester too
                if (offered.includes('fall')) {
                    return isEvenYear && isFallTerm;
                } else if (offered.includes('spring')) {
                    return isEvenYear && !isFallTerm;
                }
                return isEvenYear;
            }
            if (offered.includes('odd years')) {
                // Odd year course - should NOT be offered in 2026 (even year)
                if (offered.includes('fall')) {
                    return !isEvenYear && isFallTerm;
                } else if (offered.includes('spring')) {
                    return !isEvenYear && !isFallTerm;
                }
                return !isEvenYear;
            }
        }

        // Fall only - should be offered in fall
        if (offered.includes('fall') && !offered.includes('spring')) {
            return isFallTerm;
        }

        // Spring only - should be offered in spring
        if (offered.includes('spring') && !offered.includes('fall')) {
            return !isFallTerm;
        }

        return false;
    }

    // Get reason why course is flagged as missing
    getMissingReason(course, isFallTerm) {
        const termName = isFallTerm ? 'Fall' : 'Spring';
        if (!course.offered) return `Should be scheduled for ${termName}`;

        const offered = course.offered.toLowerCase();

        if (offered.includes('both') || offered.includes('either')) {
            return `Offered both semesters - not scheduled for ${termName} 2026`;
        }
        if (offered.includes('fall') && isFallTerm) {
            return `Fall Only course - not scheduled for Fall 2026`;
        }
        if (offered.includes('spring') && !isFallTerm) {
            return `Spring Only course - not scheduled for Spring 2027`;
        }
        if (offered.includes('even')) {
            return `Even year course (2026) - not scheduled`;
        }

        return `${course.offered} - not currently scheduled`;
    }

    // Open course history modal
    openCourseHistoryModal(course) {
        // Create modal if it doesn't exist
        let modal = document.getElementById('courseHistoryModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'courseHistoryModal';
            modal.innerHTML = `
                <div class="modal-content course-history-modal">
                    <span class="close-modal">&times;</span>
                    <h3 id="historyModalTitle">Course History</h3>
                    <div class="modal-body">
                        <div class="history-course-name" id="historyCourseName"></div>
                        <div class="history-meta" id="historyMeta"></div>
                        <div class="history-description" id="historyDescription"></div>
                        <div class="history-sections" id="historyCurrentSections"></div>
                        <div class="history-offerings-section" id="historyOfferingsSection"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.querySelector('.close-modal').addEventListener('click', () => {
                modal.style.display = 'none';
            });
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.style.display = 'none';
            });
        }

        // Populate modal
        const title = modal.querySelector('#historyModalTitle');
        const courseName = modal.querySelector('#historyCourseName');
        const meta = modal.querySelector('#historyMeta');
        const descSection = modal.querySelector('#historyDescription');
        const currentSections = modal.querySelector('#historyCurrentSections');
        const offeringsSection = modal.querySelector('#historyOfferingsSection');

        title.textContent = `${course.code} ${course.number}`;
        courseName.textContent = course.name;

        // Course metadata (credits, offered schedule, core)
        const metaParts = [];
        if (course.credits) {
            metaParts.push(`<span class="meta-credits">${course.credits} credits</span>`);
        }
        if (course.offered) {
            const offeredClass = this.getOfferedClass(course.offered);
            metaParts.push(`<span class="meta-offered ${offeredClass}">${course.offered}</span>`);
        }
        if (course.core) {
            metaParts.push(`<span class="meta-core">${course.core}</span>`);
        }
        meta.innerHTML = metaParts.join('');

        // Description (expandable)
        if (course.description) {
            const isLong = course.description.length > 200;
            const shortDesc = isLong ? course.description.substring(0, 200) + '...' : course.description;
            descSection.innerHTML = `
                <div class="description-text ${isLong ? 'collapsed' : ''}" id="descText">
                    ${isLong ? shortDesc : course.description}
                </div>
                ${isLong ? `<a href="#" class="expand-desc" id="expandDesc">Show more</a>` : ''}
            `;
            if (isLong) {
                const expandLink = descSection.querySelector('#expandDesc');
                const descText = descSection.querySelector('#descText');
                let expanded = false;
                expandLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    expanded = !expanded;
                    descText.textContent = expanded ? course.description : shortDesc;
                    descText.classList.toggle('collapsed', !expanded);
                    expandLink.textContent = expanded ? 'Show less' : 'Show more';
                });
            }
        } else {
            descSection.innerHTML = '';
        }

        // Current term sections
        const termLabel = this.currentTerm === 'fall-2026' ? 'Fall 2026' : 'Spring 2027';
        const termSections = this.scheduleData.courses.filter(c =>
            c.code === course.code && c.number === course.number
        );

        if (termSections.length > 0) {
            currentSections.innerHTML = `
                <h4>${termLabel} Sections</h4>
                ${termSections.map(s => `
                    <div class="current-section ${s.slotId ? 'scheduled' : 'unscheduled'}">
                        <strong>Section ${s.section}</strong>
                        <span>${s.instructor || 'TBA'}</span>
                        <span>${s.slotId ? this.slotLabels[s.slotId] : 'Unscheduled'}</span>
                        <span>${s.room || ''}</span>
                    </div>
                `).join('')}
            `;
        } else {
            currentSections.innerHTML = `<p class="no-sections">Not scheduled for ${termLabel}</p>`;
        }

        // Historical offerings (from 2023 onwards)
        const historyData = course.offerings || [];
        const recentOfferings = historyData.filter(o => o.year >= 2023);

        if (recentOfferings.length > 0) {
            offeringsSection.innerHTML = `
                <h4>Teaching History</h4>
                <div class="history-offerings">
                    ${recentOfferings.map(o => `
                        <div class="history-offering">
                            <span class="offering-term">${o.term} ${o.year}</span>
                            <span class="offering-instructor">${o.instructor || 'TBA'}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            offeringsSection.innerHTML = '<p class="no-history">No recent history available</p>';
        }

        modal.style.display = 'block';
    }

    // Get CSS class for offered schedule
    getOfferedClass(offered) {
        if (!offered) return '';
        const lower = offered.toLowerCase();
        if (lower.includes('fall') && !lower.includes('both') && !lower.includes('either')) {
            return 'fall-only';
        }
        if (lower.includes('spring') && !lower.includes('both') && !lower.includes('either')) {
            return 'spring-only';
        }
        if (lower.includes('odd') || lower.includes('even')) {
            return 'alternate-years';
        }
        return '';
    }

    // Create a draggable course card for unscheduled courses
    createCourseCard(course) {
        const card = document.createElement('div');
        card.className = `course-card ${this.getDayClass(course.days)}`;
        card.draggable = true;
        card.dataset.courseId = course.id;

        card.innerHTML = `
            <div class="course-code">${course.code} ${course.number}</div>
            <div class="course-name">${course.name || ''}</div>
            <div class="course-instructor">${course.instructor || 'TBA'}</div>
            <div class="course-days">${course.days || 'TBD'}</div>
        `;

        // Drag events
        card.addEventListener('dragstart', (e) => this.handleDragStart(e, course));
        card.addEventListener('dragend', (e) => this.handleDragEnd(e));

        // Click to edit
        card.addEventListener('click', () => this.openModal(course));

        return card;
    }

    // Get CSS class based on day
    getDayClass(days) {
        if (!days) return '';
        if (days.includes('MW')) return 'mw-course';
        if (days.includes('TR') && !days.includes('EVE')) return 'tr-course';
        if (days.includes('EVE') || days.includes('SAT')) return 'eve-course';
        return '';
    }

    // Render schedule grid
    renderScheduleGrid() {
        const dropZones = document.querySelectorAll('.drop-zone');

        dropZones.forEach(zone => {
            const slotId = zone.dataset.slot;
            const coursesInSlot = this.scheduleData.courses.filter(c => c.slotId === slotId);

            // Clear existing content
            zone.innerHTML = '';

            // Add courses
            coursesInSlot.forEach(course => {
                const courseEl = this.createScheduledCourse(course);
                zone.appendChild(courseEl);
            });

            // Setup drop zone events
            zone.addEventListener('dragover', (e) => this.handleDragOver(e));
            zone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
            zone.addEventListener('drop', (e) => this.handleDrop(e, slotId));

            // Double-click to add new course to this slot
            zone.addEventListener('dblclick', (e) => {
                // Don't trigger if clicking on an existing course
                if (e.target.closest('.scheduled-course')) return;
                this.openAddCourseModal(slotId);
            });
        });
    }

    // Create scheduled course element in grid
    createScheduledCourse(course) {
        const el = document.createElement('div');
        el.className = 'scheduled-course';
        el.dataset.courseId = course.id;

        // Add bimodal indicator for 500+ level courses with bimodal enabled
        const bimodalBadge = course.bimodal ? '<span class="bimodal-badge" title="Bimodal (in-person + online)">B</span>' : '';

        el.innerHTML = `
            <span class="course-code">${course.code} ${course.number}${bimodalBadge}</span>
            <span class="course-instructor">${course.instructor || 'TBA'}</span>
            <span class="course-room">${course.room || ''}</span>
        `;

        el.draggable = true;
        el.addEventListener('dragstart', (e) => this.handleDragStart(e, course));
        el.addEventListener('dragend', (e) => this.handleDragEnd(e));
        el.addEventListener('click', () => this.openModal(course));

        return el;
    }

    // Drag handlers
    handleDragStart(e, course) {
        e.dataTransfer.setData('text/plain', course.id);
        e.target.classList.add('dragging');
    }

    handleDragEnd(e) {
        e.target.classList.remove('dragging');
        document.querySelectorAll('.drop-zone').forEach(z => z.classList.remove('drag-over'));
    }

    handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('drag-over');
    }

    handleDragLeave(e) {
        e.currentTarget.classList.remove('drag-over');
    }

    handleDrop(e, slotId) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');

        const courseId = e.dataTransfer.getData('text/plain');
        this.moveCourse(courseId, slotId);
    }

    // Move course to new slot
    moveCourse(courseId, slotId, skipHistory = false) {
        const course = this.scheduleData.courses.find(c => c.id === courseId);
        if (!course) return;

        // Store previous state for undo
        const previousSlotId = course.slotId;
        const previousRoom = course.room;

        // Check for room conflict (same room, same time slot) - clear room if conflict
        let roomCleared = false;
        if (slotId && course.room) {
            const conflictingCourse = this.scheduleData.courses.find(c =>
                c.id !== courseId &&
                c.slotId === slotId &&
                c.room &&
                c.room === course.room
            );
            if (conflictingCourse) {
                course.room = '';
                roomCleared = true;
            }
        }

        // Update local data
        course.slotId = slotId;

        // Record action for undo (unless this is an undo operation)
        if (!skipHistory) {
            this.recordAction({
                type: 'move',
                courseId: courseId,
                courseCode: `${course.code} ${course.number}`,
                previousSlotId: previousSlotId,
                newSlotId: slotId,
                previousRoom: previousRoom
            });
        }

        // Send to server via WebSocket with room update if cleared
        if (roomCleared) {
            this.socket.emit('move_course', { courseId, slotId, term: this.currentTerm, clearRoom: true });
            this.showToast(`Room cleared due to conflict - please reassign`, 'info');
        } else {
            this.socket.emit('move_course', { courseId, slotId, term: this.currentTerm });
        }

        // Re-render
        this.renderCourseList();
        this.renderScheduleGrid();
        this.highlightFacultyCourses();
        this.updateFacultyPanel();
    }

    // Handle schedule update from server
    handleScheduleUpdate(data) {
        const course = this.scheduleData.courses.find(c => c.id === data.courseId);
        if (course) {
            course.slotId = data.slotId;
        }

        this.renderCourseList();
        this.renderScheduleGrid();
        this.highlightFacultyCourses();
        this.updateFacultyPanel();
    }

    // Handle course update from server
    handleCourseUpdate(data) {
        const course = this.scheduleData.courses.find(c => c.id === data.courseId);
        if (course) {
            Object.assign(course, data.updates);
        }

        this.renderCourseList();
        this.renderScheduleGrid();
        this.highlightFacultyCourses();
        this.updateFacultyPanel();
    }

    // Highlight courses for selected faculty
    highlightFacultyCourses() {
        // Remove all highlights
        document.querySelectorAll('.course-card, .scheduled-course').forEach(el => {
            el.classList.remove('highlight');
            el.classList.remove('faculty-highlight');
        });

        if (!this.selectedFaculty) return;

        // Add highlights
        this.scheduleData.courses.forEach(course => {
            if (course.instructor === this.selectedFaculty) {
                const card = document.querySelector(`.course-card[data-course-id="${course.id}"]`);
                const scheduled = document.querySelector(`.scheduled-course[data-course-id="${course.id}"]`);

                if (card) card.classList.add('highlight');
                if (scheduled) {
                    scheduled.classList.add('highlight');
                    scheduled.classList.add('faculty-highlight');
                }
            }
        });
    }

    // Filter courses in sidebar - re-renders the list with filter applied
    filterCourses(query) {
        this.renderCourseList();
    }

    // Modal functions
    openModal(course) {
        this.currentCourseId = course.id;

        document.getElementById('modalTitle').textContent = `${course.code} ${course.number}`;
        document.getElementById('modalCourse').textContent = course.name || '';

        // Populate instructor dropdown
        this.populateInstructorDropdown(
            document.getElementById('modalInstructor'),
            course.instructor || ''
        );

        // Populate room dropdown
        const roomSelect = document.getElementById('modalRoom');
        roomSelect.innerHTML = '<option value="">Select Room</option>';
        this.rooms.forEach(room => {
            const option = document.createElement('option');
            option.value = room;
            option.textContent = room;
            roomSelect.appendChild(option);
        });
        roomSelect.value = course.room || '';

        // Show bimodal checkbox for 500+ level courses
        const bimodalGroup = document.getElementById('bimodalGroup');
        const bimodalCheckbox = document.getElementById('modalBimodal');
        const courseNum = parseInt(course.number, 10);
        if (courseNum >= 500) {
            bimodalGroup.style.display = 'block';
            bimodalCheckbox.checked = course.bimodal || false;
        } else {
            bimodalGroup.style.display = 'none';
            bimodalCheckbox.checked = false;
        }

        const scheduledText = course.slotId ? this.slotLabels[course.slotId] || course.slotId : 'Not scheduled';
        document.getElementById('modalScheduled').textContent = scheduledText;

        document.getElementById('courseModal').classList.add('show');
    }

    closeModal() {
        document.getElementById('courseModal').classList.remove('show');
        this.currentCourseId = null;
    }

    async saveModalChanges() {
        if (!this.currentCourseId) return;

        const course = this.scheduleData.courses.find(c => c.id === this.currentCourseId);
        const courseNum = parseInt(course.number, 10);

        const updates = {
            instructor: document.getElementById('modalInstructor').value,
            room: document.getElementById('modalRoom').value
        };

        // Include bimodal for 500+ level courses
        if (courseNum >= 500) {
            updates.bimodal = document.getElementById('modalBimodal').checked;
        }

        // Check for room conflict if course is scheduled and has a room
        if (course && course.slotId && updates.room) {
            const conflictingCourse = this.scheduleData.courses.find(c =>
                c.id !== this.currentCourseId &&
                c.slotId === course.slotId &&
                c.room === updates.room
            );
            if (conflictingCourse) {
                this.showToast(`Room conflict: ${updates.room} is already used by ${conflictingCourse.code} ${conflictingCourse.number} at this time`, 'error');
                return;
            }
        }

        // Store previous values for undo
        const previousValues = {
            instructor: course.instructor,
            room: course.room,
            bimodal: course.bimodal
        };

        try {
            const response = await fetch('/api/course', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseId: this.currentCourseId,
                    updates,
                    term: this.currentTerm
                })
            });

            if (response.ok) {
                // Record action for undo
                this.recordAction({
                    type: 'update',
                    courseId: this.currentCourseId,
                    courseCode: `${course.code} ${course.number}`,
                    previousValues: previousValues,
                    newValues: updates
                });

                // Update local data
                Object.assign(course, updates);

                this.renderCourseList();
                this.renderScheduleGrid();
                this.highlightFacultyCourses();
                this.closeModal();
                this.showToast('Course updated', 'success');
            }
        } catch (error) {
            console.error('Failed to save changes:', error);
            this.showToast('Failed to save changes', 'error');
        }
    }

    removeCourseFromSchedule() {
        if (!this.currentCourseId) return;

        this.moveCourse(this.currentCourseId, null);
        this.closeModal();
    }

    // Add Course modal functions
    openAddCourseModal(slotId = null) {
        // Store the pending slot
        this.pendingSlotId = slotId;

        // Clear form
        document.getElementById('addCourseCode').value = '';
        document.getElementById('addCourseNumber').value = '';
        document.getElementById('addCourseName').value = '';

        // Populate instructor dropdown
        this.populateInstructorDropdown(document.getElementById('addCourseInstructor'));

        // Populate room dropdown
        const roomSelect = document.getElementById('addCourseRoom');
        roomSelect.innerHTML = '<option value="">Select Room</option>';
        this.rooms.forEach(room => {
            const option = document.createElement('option');
            option.value = room;
            option.textContent = room;
            roomSelect.appendChild(option);
        });

        // Show the scheduled time if a slot was selected
        const slotInfo = document.getElementById('addCourseSlotInfo');
        if (slotInfo) {
            if (slotId && this.slotLabels[slotId]) {
                slotInfo.textContent = `Time: ${this.slotLabels[slotId]}`;
                slotInfo.style.display = 'block';
            } else {
                slotInfo.style.display = 'none';
            }
        }

        document.getElementById('addCourseModal').classList.add('show');
    }

    closeAddCourseModal() {
        document.getElementById('addCourseModal').classList.remove('show');
        this.pendingSlotId = null;
    }

    async submitNewCourse() {
        const code = document.getElementById('addCourseCode').value.trim();
        const number = document.getElementById('addCourseNumber').value.trim();
        const name = document.getElementById('addCourseName').value.trim();
        const instructor = document.getElementById('addCourseInstructor').value.trim();
        const room = document.getElementById('addCourseRoom').value;
        const slotId = this.pendingSlotId;

        if (!code || !number) {
            this.showToast('Course code and number are required', 'error');
            return;
        }

        try {
            const response = await fetch('/api/course/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, number, name, instructor, room, slotId, term: this.currentTerm })
            });

            if (response.ok) {
                const data = await response.json();

                // Record action for undo
                this.recordAction({
                    type: 'add',
                    courseId: data.course.id,
                    courseCode: `${data.course.code} ${data.course.number}`,
                    course: data.course
                });

                this.closeAddCourseModal();
                const slotText = slotId ? ` to ${this.slotLabels[slotId]}` : '';
                this.showToast(`${data.course.code} ${data.course.number} added${slotText}`, 'success');
            } else {
                this.showToast('Failed to add course', 'error');
            }
        } catch (error) {
            console.error('Failed to add course:', error);
            this.showToast('Failed to add course', 'error');
        }
    }

    // Faculty modal functions
    openFacultyModal() {
        this.renderFacultyList();
        document.getElementById('newFacultyName').value = '';
        document.getElementById('facultyModal').classList.add('show');
    }

    closeFacultyModal() {
        document.getElementById('facultyModal').classList.remove('show');
    }

    renderFacultyList() {
        const listEl = document.getElementById('facultyList');
        const faculty = this.scheduleData.faculty || [];

        listEl.innerHTML = '';
        faculty.forEach(name => {
            const item = document.createElement('div');
            item.className = 'faculty-item';
            item.innerHTML = `
                <span>${name}</span>
                <button class="btn-delete" data-faculty="${name}">&times;</button>
            `;
            item.querySelector('.btn-delete').addEventListener('click', () => {
                this.deleteFaculty(name);
            });
            listEl.appendChild(item);
        });

        if (faculty.length === 0) {
            listEl.innerHTML = '<p style="color: #666; font-style: italic;">No faculty added yet</p>';
        }
    }

    async addFaculty() {
        const nameInput = document.getElementById('newFacultyName');
        const name = nameInput.value.trim();

        if (!name) {
            this.showToast('Please enter a faculty name', 'error');
            return;
        }

        try {
            const response = await fetch('/api/faculty/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, term: this.currentTerm })
            });

            if (response.ok) {
                nameInput.value = '';
                this.showToast(`${name} added to faculty`, 'success');
            } else {
                this.showToast('Failed to add faculty', 'error');
            }
        } catch (error) {
            console.error('Failed to add faculty:', error);
            this.showToast('Failed to add faculty', 'error');
        }
    }

    async deleteFaculty(name) {
        if (!confirm(`Remove ${name} from faculty list?`)) return;

        try {
            const response = await fetch('/api/faculty/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, term: this.currentTerm })
            });

            if (response.ok) {
                this.showToast(`${name} removed from faculty`, 'success');
            } else {
                this.showToast('Failed to remove faculty', 'error');
            }
        } catch (error) {
            console.error('Failed to delete faculty:', error);
            this.showToast('Failed to remove faculty', 'error');
        }
    }

    // History tracking and undo
    recordAction(action) {
        action.timestamp = new Date().toISOString();
        this.actionHistory.unshift(action); // Add to beginning
        if (this.actionHistory.length > 50) {
            this.actionHistory.pop(); // Keep max 50 actions
        }
        this.updateUndoButton();
        this.renderHistoryPanel();
    }

    formatActionDescription(action) {
        const time = new Date(action.timestamp).toLocaleTimeString();
        switch (action.type) {
            case 'move':
                const fromSlot = action.previousSlotId ? this.slotLabels[action.previousSlotId] || action.previousSlotId : 'Unscheduled';
                const toSlot = action.newSlotId ? this.slotLabels[action.newSlotId] || action.newSlotId : 'Unscheduled';
                return `${time} - Moved ${action.courseCode} from ${fromSlot} to ${toSlot}`;
            case 'update':
                const changes = [];
                if (action.previousValues.instructor !== action.newValues.instructor) {
                    changes.push(`instructor: ${action.previousValues.instructor || 'none'} → ${action.newValues.instructor || 'none'}`);
                }
                if (action.previousValues.room !== action.newValues.room) {
                    changes.push(`room: ${action.previousValues.room || 'none'} → ${action.newValues.room || 'none'}`);
                }
                return `${time} - Updated ${action.courseCode}: ${changes.join(', ')}`;
            case 'add':
                return `${time} - Added ${action.courseCode}`;
            default:
                return `${time} - ${action.type}`;
        }
    }

    updateUndoButton() {
        const undoBtn = document.getElementById('undoBtn');
        if (undoBtn) {
            undoBtn.disabled = this.actionHistory.length === 0;
            const count = this.actionHistory.length;
            undoBtn.title = count > 0 ? `Undo (${count} actions)` : 'Nothing to undo';
        }
    }

    async undo() {
        if (this.actionHistory.length === 0) {
            this.showToast('Nothing to undo', 'info');
            return;
        }

        const action = this.actionHistory.shift();

        try {
            switch (action.type) {
                case 'move':
                    // Restore previous slot and room
                    const course = this.scheduleData.courses.find(c => c.id === action.courseId);
                    if (course) {
                        course.slotId = action.previousSlotId;
                        if (action.previousRoom !== undefined) {
                            course.room = action.previousRoom;
                        }
                        await fetch('/api/undo', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                type: 'move',
                                courseId: action.courseId,
                                slotId: action.previousSlotId,
                                room: action.previousRoom,
                                term: this.currentTerm
                            })
                        });
                    }
                    break;

                case 'update':
                    // Restore previous values
                    const updateCourse = this.scheduleData.courses.find(c => c.id === action.courseId);
                    if (updateCourse) {
                        Object.assign(updateCourse, action.previousValues);
                        await fetch('/api/undo', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                type: 'update',
                                courseId: action.courseId,
                                updates: action.previousValues,
                                term: this.currentTerm
                            })
                        });
                    }
                    break;

                case 'add':
                    // Remove the added course
                    this.scheduleData.courses = this.scheduleData.courses.filter(c => c.id !== action.courseId);
                    await fetch('/api/undo', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 'delete',
                            courseId: action.courseId,
                            term: this.currentTerm
                        })
                    });
                    break;
            }

            this.renderCourseList();
            this.renderScheduleGrid();
            this.highlightFacultyCourses();
            this.updateFacultyPanel();
            this.updateUndoButton();
            this.renderHistoryPanel();
            this.showToast('Undo successful', 'success');
        } catch (error) {
            console.error('Undo failed:', error);
            this.showToast('Undo failed', 'error');
        }
    }

    toggleHistoryPanel() {
        this.historyPanelOpen = !this.historyPanelOpen;
        const panel = document.getElementById('historyPanel');
        if (panel) {
            panel.classList.toggle('open', this.historyPanelOpen);
        }
    }

    renderHistoryPanel() {
        const content = document.getElementById('historyContent');
        if (!content) return;

        if (this.actionHistory.length === 0) {
            content.innerHTML = '<p class="no-history">No actions recorded yet</p>';
            return;
        }

        content.innerHTML = this.actionHistory.map((action, index) => `
            <div class="history-item" data-index="${index}">
                <span class="history-text">${this.formatActionDescription(action)}</span>
            </div>
        `).join('');
    }

    // Restore modal functions
    openRestoreModal() {
        document.getElementById('restorePassword').value = '';
        document.getElementById('restoreFile').value = '';
        document.getElementById('restoreModal').classList.add('show');
    }

    closeRestoreModal() {
        document.getElementById('restoreModal').classList.remove('show');
    }

    // AI Analysis modal functions
    openAiModal() {
        document.getElementById('aiModal').classList.add('show');
        document.getElementById('aiLoading').style.display = 'none';
        document.getElementById('aiContent').style.display = 'block';
        document.getElementById('aiResults').style.display = 'none';
    }

    closeAiModal() {
        document.getElementById('aiModal').classList.remove('show');
    }

    async runAiAnalysis() {
        const loadingEl = document.getElementById('aiLoading');
        const contentEl = document.getElementById('aiContent');
        const resultsEl = document.getElementById('aiResults');

        loadingEl.style.display = 'block';
        contentEl.style.display = 'none';
        resultsEl.style.display = 'none';

        try {
            const response = await fetch('/api/ai-recommendations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ term: this.currentTerm })
            });

            const data = await response.json();

            loadingEl.style.display = 'none';

            if (data.success) {
                // Convert markdown-style formatting to HTML
                let html = data.recommendations
                    .replace(/### (.*)/g, '<h3>$1</h3>')
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/`(.*?)`/g, '<code>$1</code>')
                    .replace(/^\- (.*)/gm, '<li>$1</li>')
                    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
                    .replace(/\n\n/g, '</p><p>')
                    .replace(/\n/g, '<br>');

                resultsEl.innerHTML = html;
                resultsEl.style.display = 'block';
            } else {
                resultsEl.innerHTML = `<p style="color: #dc3545;">Error: ${data.error}</p>`;
                resultsEl.style.display = 'block';
            }
        } catch (error) {
            loadingEl.style.display = 'none';
            resultsEl.innerHTML = `<p style="color: #dc3545;">Error: ${error.message}</p>`;
            resultsEl.style.display = 'block';
        }
    }

    async submitRestore() {
        const password = document.getElementById('restorePassword').value;
        const fileInput = document.getElementById('restoreFile');

        if (!password) {
            this.showToast('Please enter the password', 'error');
            return;
        }

        if (!fileInput.files || fileInput.files.length === 0) {
            this.showToast('Please select a backup file', 'error');
            return;
        }

        const file = fileInput.files[0];
        if (!file.name.endsWith('.zip')) {
            this.showToast('File must be a .zip archive', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('password', password);
        formData.append('file', file);

        try {
            const response = await fetch('/api/restore', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.closeRestoreModal();
                this.showToast(`Restored: ${data.restored.join(', ')}`, 'success');
                setTimeout(() => window.location.reload(), 1500);
            } else {
                this.showToast(data.error || 'Restore failed', 'error');
            }
        } catch (error) {
            console.error('Restore failed:', error);
            this.showToast('Restore failed', 'error');
        }
    }

    // Toast notifications
    showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.scheduler = new CourseScheduler();
});
