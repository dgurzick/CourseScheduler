// Course Scheduler Application
// Real-time drag-and-drop scheduling with WebSocket sync

class CourseScheduler {
    constructor() {
        this.socket = null;
        this.scheduleData = { courses: [], instructors: [], timeSlots: {} };
        this.selectedFaculty = '';
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
        await this.loadSchedule();
        this.initSocket();
        this.setupEventListeners();
        this.renderCourseList();
        this.renderScheduleGrid();
        this.populateFacultyDropdown();
    }

    // Load schedule data from server
    async loadSchedule() {
        try {
            const response = await fetch('/api/schedule');
            this.scheduleData = await response.json();
        } catch (error) {
            console.error('Failed to load schedule:', error);
            this.showToast('Failed to load schedule', 'error');
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
            this.handleScheduleUpdate(data);
        });

        this.socket.on('course_update', (data) => {
            console.log('Course update received:', data);
            this.handleCourseUpdate(data);
        });

        this.socket.on('full_sync', (data) => {
            console.log('Full sync received');
            this.scheduleData = data;
            this.renderCourseList();
            this.renderScheduleGrid();
        });

        this.socket.on('course_added', (data) => {
            console.log('Course added:', data);
            this.scheduleData.courses.push(data.course);
            this.renderCourseList();
            this.renderScheduleGrid();
            this.populateFacultyDropdown();
        });

        this.socket.on('faculty_added', (data) => {
            console.log('Faculty added:', data);
            if (!this.scheduleData.faculty) {
                this.scheduleData.faculty = [];
            }
            if (!this.scheduleData.faculty.includes(data.name)) {
                this.scheduleData.faculty.push(data.name);
                this.scheduleData.faculty.sort();
            }
            this.populateFacultyDropdown();
            this.renderFacultyList();
        });

        this.socket.on('faculty_deleted', (data) => {
            console.log('Faculty deleted:', data);
            if (this.scheduleData.faculty) {
                this.scheduleData.faculty = this.scheduleData.faculty.filter(f => f !== data.name);
            }
            this.populateFacultyDropdown();
            this.renderFacultyList();
        });

        this.socket.on('course_deleted', (data) => {
            console.log('Course deleted:', data);
            this.scheduleData.courses = this.scheduleData.courses.filter(c => c.id !== data.courseId);
            this.renderCourseList();
            this.renderScheduleGrid();
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
        // Faculty dropdown
        document.getElementById('facultyDropdown').addEventListener('change', (e) => {
            this.selectedFaculty = e.target.value;
            this.highlightFacultyCourses();
        });

        // Course filter
        document.getElementById('courseFilter').addEventListener('input', (e) => {
            this.filterCourses(e.target.value);
        });

        // Export buttons
        document.getElementById('exportJson').addEventListener('click', () => {
            window.location.href = '/api/export/json';
        });

        document.getElementById('exportExcel').addEventListener('click', () => {
            window.location.href = '/api/export/excel';
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

    // Render unscheduled courses in sidebar
    renderCourseList() {
        const courseList = document.getElementById('courseList');
        courseList.innerHTML = '';

        const unscheduledCourses = this.scheduleData.courses.filter(c => !c.slotId);

        unscheduledCourses.forEach(course => {
            const card = this.createCourseCard(course);
            courseList.appendChild(card);
        });
    }

    // Create a course card element
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

        el.innerHTML = `
            <span class="course-code">${course.code} ${course.number}</span>
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
            this.socket.emit('move_course', { courseId, slotId, clearRoom: true });
            this.showToast(`Room cleared due to conflict - please reassign`, 'info');
        } else {
            this.socket.emit('move_course', { courseId, slotId });
        }

        // Re-render
        this.renderCourseList();
        this.renderScheduleGrid();
        this.highlightFacultyCourses();
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
    }

    // Highlight courses for selected faculty
    highlightFacultyCourses() {
        // Remove all highlights
        document.querySelectorAll('.course-card, .scheduled-course').forEach(el => {
            el.classList.remove('highlight');
        });

        if (!this.selectedFaculty) return;

        // Add highlights
        this.scheduleData.courses.forEach(course => {
            if (course.instructor === this.selectedFaculty) {
                const card = document.querySelector(`.course-card[data-course-id="${course.id}"]`);
                const scheduled = document.querySelector(`.scheduled-course[data-course-id="${course.id}"]`);

                if (card) card.classList.add('highlight');
                if (scheduled) scheduled.classList.add('highlight');
            }
        });
    }

    // Filter courses in sidebar
    filterCourses(query) {
        const cards = document.querySelectorAll('#courseList .course-card');
        const lowerQuery = query.toLowerCase();

        cards.forEach(card => {
            const text = card.textContent.toLowerCase();
            card.style.display = text.includes(lowerQuery) ? '' : 'none';
        });
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

        const updates = {
            instructor: document.getElementById('modalInstructor').value,
            room: document.getElementById('modalRoom').value
        };

        // Check for room conflict if course is scheduled and has a room
        const course = this.scheduleData.courses.find(c => c.id === this.currentCourseId);
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
            room: course.room
        };

        try {
            const response = await fetch('/api/course', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseId: this.currentCourseId,
                    updates
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
                body: JSON.stringify({ code, number, name, instructor, room, slotId })
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
                body: JSON.stringify({ name })
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
                body: JSON.stringify({ name })
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
                                room: action.previousRoom
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
                                updates: action.previousValues
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
                            courseId: action.courseId
                        })
                    });
                    break;
            }

            this.renderCourseList();
            this.renderScheduleGrid();
            this.highlightFacultyCourses();
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
