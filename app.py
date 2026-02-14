import json
import os
from datetime import datetime
from io import BytesIO
import zipfile
import tempfile

from flask import Flask, render_template, jsonify, request, send_file
from werkzeug.utils import secure_filename
from flask_socketio import SocketIO, emit
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

async_mode = 'eventlet' if os.environ.get('RENDER') else 'threading'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode=async_mode)

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
DATA_FILE = os.path.join(DATA_DIR, 'schedule.json')
HISTORY_FILE = os.path.join(DATA_DIR, 'course_history.json')

# Valid terms
VALID_TERMS = ['fall-2026', 'spring-2027']
DEFAULT_TERM = 'fall-2026'

# Reset password
RESET_PASSWORD = 'donkey'


def get_schedule_file(term):
    """Get schedule file path for a specific term."""
    if term not in VALID_TERMS:
        term = DEFAULT_TERM
    if term == 'fall-2026':
        return DATA_FILE  # Use existing schedule.json for fall-2026
    return os.path.join(DATA_DIR, f'schedule_{term.replace("-", "_")}.json')


def load_course_history():
    """Load course history data from JSON file."""
    try:
        with open(HISTORY_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def load_schedule(term=None):
    """Load schedule data from JSON file for a specific term."""
    if term is None:
        term = DEFAULT_TERM
    schedule_file = get_schedule_file(term)
    try:
        with open(schedule_file, 'r') as f:
            data = json.load(f)
            data['term'] = term
            return data
    except FileNotFoundError:
        # For new terms, start with empty schedule but copy faculty/timeSlots from default
        default_data = load_schedule(DEFAULT_TERM) if term != DEFAULT_TERM else {}
        return {
            "term": term,
            "courses": [],
            "instructors": default_data.get("instructors", []),
            "faculty": default_data.get("faculty", []),
            "timeSlots": default_data.get("timeSlots", {})
        }


def save_schedule(data, term=None):
    """Save schedule data to JSON file for a specific term."""
    if term is None:
        term = data.get('term', DEFAULT_TERM)
    schedule_file = get_schedule_file(term)
    os.makedirs(os.path.dirname(schedule_file), exist_ok=True)
    with open(schedule_file, 'w') as f:
        json.dump(data, f, indent=2)


@app.route('/')
def index():
    """Serve the main schedule page."""
    return render_template('index.html')


@app.route('/api/schedule')
def get_schedule():
    """Return current schedule data."""
    term = request.args.get('term', DEFAULT_TERM)
    return jsonify(load_schedule(term))


@app.route('/api/schedule', methods=['POST'])
def update_schedule():
    """Update schedule and broadcast to all clients."""
    data = request.json
    term = data.get('term', DEFAULT_TERM)
    schedule = load_schedule(term)

    course_id = data.get('courseId')
    new_slot_id = data.get('slotId')

    for course in schedule['courses']:
        if course['id'] == course_id:
            course['slotId'] = new_slot_id
            break

    save_schedule(schedule, term)

    socketio.emit('schedule_update', {
        'courseId': course_id,
        'slotId': new_slot_id,
        'term': term,
        'timestamp': datetime.now().isoformat()
    })

    return jsonify({'success': True})


@app.route('/api/course', methods=['POST'])
def update_course():
    """Update course details."""
    data = request.json
    term = data.get('term', DEFAULT_TERM)
    schedule = load_schedule(term)

    course_id = data.get('courseId')
    updates = data.get('updates', {})

    for course in schedule['courses']:
        if course['id'] == course_id:
            for key, value in updates.items():
                if key in course:
                    course[key] = value
            break

    save_schedule(schedule, term)

    socketio.emit('course_update', {
        'courseId': course_id,
        'updates': updates,
        'term': term,
        'timestamp': datetime.now().isoformat()
    })

    return jsonify({'success': True})


@app.route('/api/course/add', methods=['POST'])
def add_course():
    """Add a new course."""
    data = request.json
    term = data.get('term', DEFAULT_TERM)
    schedule = load_schedule(term)

    code = data.get('code', '').upper()
    number = data.get('number', '')
    name = data.get('name', '')
    instructor = data.get('instructor', '')
    room = data.get('room', '')
    slot_id = data.get('slotId')

    # Find the next available section number for this course
    existing_sections = [
        int(c['section']) for c in schedule['courses']
        if c['code'] == code and c['number'] == number and c['section'].isdigit()
    ]
    next_section = str(max(existing_sections, default=0) + 1)

    course_id = f"{code}-{number}-{next_section}"

    new_course = {
        'id': course_id,
        'code': code,
        'number': number,
        'section': next_section,
        'name': name,
        'days': '',
        'startTime': '',
        'endTime': '',
        'instructor': instructor,
        'room': room,
        'slotId': slot_id
    }

    schedule['courses'].append(new_course)
    save_schedule(schedule, term)

    socketio.emit('course_added', {
        'course': new_course,
        'term': term,
        'timestamp': datetime.now().isoformat()
    }, broadcast=True)

    return jsonify({'success': True, 'course': new_course})


@app.route('/api/faculty', methods=['GET'])
def get_faculty():
    """Get all faculty members."""
    term = request.args.get('term', DEFAULT_TERM)
    schedule = load_schedule(term)
    return jsonify(schedule.get('faculty', []))


@app.route('/api/course-history')
def get_course_history():
    """Return all course history data."""
    return jsonify(load_course_history())


@app.route('/api/course-history/<course_id>')
def get_course_history_by_id(course_id):
    """Return history for a specific course."""
    history = load_course_history()
    if course_id in history:
        return jsonify(history[course_id])
    return jsonify({'error': 'Course not found'}), 404


@app.route('/api/faculty/add', methods=['POST'])
def add_faculty():
    """Add a new faculty member."""
    data = request.json
    term = data.get('term', DEFAULT_TERM)
    schedule = load_schedule(term)

    name = data.get('name', '').strip()
    if not name:
        return jsonify({'success': False, 'error': 'Name is required'}), 400

    if 'faculty' not in schedule:
        schedule['faculty'] = []

    if name not in schedule['faculty']:
        schedule['faculty'].append(name)
        schedule['faculty'].sort()
        save_schedule(schedule, term)

        socketio.emit('faculty_added', {
            'name': name,
            'term': term,
            'timestamp': datetime.now().isoformat()
        }, broadcast=True)

    return jsonify({'success': True, 'name': name})


@app.route('/api/faculty/delete', methods=['POST'])
def delete_faculty():
    """Delete a faculty member."""
    data = request.json
    term = data.get('term', DEFAULT_TERM)
    schedule = load_schedule(term)

    name = data.get('name', '')
    if 'faculty' in schedule and name in schedule['faculty']:
        schedule['faculty'].remove(name)
        save_schedule(schedule, term)

        socketio.emit('faculty_deleted', {
            'name': name,
            'term': term,
            'timestamp': datetime.now().isoformat()
        }, broadcast=True)

    return jsonify({'success': True})


@app.route('/api/undo', methods=['POST'])
def undo_action():
    """Undo a previous action."""
    data = request.json
    term = data.get('term', DEFAULT_TERM)
    schedule = load_schedule(term)
    action_type = data.get('type')

    if action_type == 'move':
        course_id = data.get('courseId')
        slot_id = data.get('slotId')
        room = data.get('room')

        for course in schedule['courses']:
            if course['id'] == course_id:
                course['slotId'] = slot_id
                if room is not None:
                    course['room'] = room
                break

        save_schedule(schedule, term)

        socketio.emit('schedule_update', {
            'courseId': course_id,
            'slotId': slot_id,
            'term': term,
            'timestamp': datetime.now().isoformat()
        }, broadcast=True)

    elif action_type == 'update':
        course_id = data.get('courseId')
        updates = data.get('updates', {})

        for course in schedule['courses']:
            if course['id'] == course_id:
                for key, value in updates.items():
                    course[key] = value
                break

        save_schedule(schedule, term)

        socketio.emit('course_update', {
            'courseId': course_id,
            'updates': updates,
            'term': term,
            'timestamp': datetime.now().isoformat()
        }, broadcast=True)

    elif action_type == 'delete':
        course_id = data.get('courseId')
        schedule['courses'] = [c for c in schedule['courses'] if c['id'] != course_id]
        save_schedule(schedule, term)

        socketio.emit('course_deleted', {
            'courseId': course_id,
            'term': term,
            'timestamp': datetime.now().isoformat()
        }, broadcast=True)

    return jsonify({'success': True})


@app.route('/api/export/json')
def export_json():
    """Download schedule as JSON file."""
    schedule = load_schedule()
    buffer = BytesIO()
    buffer.write(json.dumps(schedule, indent=2).encode('utf-8'))
    buffer.seek(0)

    return send_file(
        buffer,
        mimetype='application/json',
        as_attachment=True,
        download_name=f'schedule_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    )


@app.route('/api/export/excel')
def export_excel():
    """Download schedule as Excel file."""
    schedule = load_schedule()

    wb = Workbook()
    ws = wb.active
    ws.title = "Fall 2026 Schedule"

    header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True, size=12)
    mw_fill = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
    tr_fill = PatternFill(start_color="FDE9D9", end_color="FDE9D9", fill_type="solid")
    eve_fill = PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid")
    thin_border = Border(
        left=Side(style='thin'),
        right=Side(style='thin'),
        top=Side(style='thin'),
        bottom=Side(style='thin')
    )

    ws.merge_cells('A1:R1')
    ws['A1'] = "DELAPLAINE SCHOOL OF BUSINESS - Fall 2026 Schedule"
    ws['A1'].font = Font(bold=True, size=16, color="FFFFFF")
    ws['A1'].fill = header_fill
    ws['A1'].alignment = Alignment(horizontal='center')

    headers = ['', '', 'MW 8:15-9:40', 'MW 9:50-11:15', 'MW 11:30-12:55', 'MW 1:05-2:30', 'MW 2:40-4:05',
               'TR 8:15-9:40', 'TR 9:50-11:15', 'TR 11:25-12:50', 'TR 2:00-3:25', 'TR 3:35-5:00',
               'M Eve', 'T Eve', 'W Eve', 'TR Eve', 'SAT', 'ASYNCH']

    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=2, column=col, value=header)
        cell.font = Font(bold=True, size=10)
        cell.fill = PatternFill(start_color="D9D9D9", end_color="D9D9D9", fill_type="solid")
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cell.border = thin_border

    slot_labels = ['', '', 'A', 'B', 'C', 'D', 'E', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'SAT', 'ASYNCH']
    for col, label in enumerate(slot_labels, 1):
        cell = ws.cell(row=3, column=col, value=label)
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="BFBFBF", end_color="BFBFBF", fill_type="solid")
        cell.alignment = Alignment(horizontal='center')
        cell.border = thin_border

    slot_map = {
        'MW-A': 3, 'MW-B': 4, 'MW-C': 5, 'MW-D': 6, 'MW-E': 7,
        'TR-G': 8, 'TR-H': 9, 'TR-I': 10, 'TR-J': 11, 'TR-K': 12,
        'M-EVE': 13, 'T-EVE': 14, 'W-EVE': 15, 'TR-EVE': 16,
        'SAT': 17, 'ASYNCH': 18
    }

    grid = {}
    for course in schedule['courses']:
        slot_id = course.get('slotId')
        if slot_id and slot_id in slot_map:
            col = slot_map[slot_id]
            if col not in grid:
                grid[col] = []
            grid[col].append(f"{course['code']} {course['number']}\n{course['instructor']}")

    max_rows = max([len(courses) for courses in grid.values()]) if grid else 1

    for row_offset in range(max_rows):
        row = 4 + row_offset
        for col in range(3, 19):
            cell = ws.cell(row=row, column=col, value='')
            cell.border = thin_border
            cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)

            if col <= 7:
                cell.fill = mw_fill
            elif col <= 12:
                cell.fill = tr_fill
            else:
                cell.fill = eve_fill

            if col in grid and row_offset < len(grid[col]):
                cell.value = grid[col][row_offset]

    for col in range(1, 19):
        ws.column_dimensions[ws.cell(row=1, column=col).column_letter].width = 15

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    return send_file(
        buffer,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=f'schedule_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
    )


@app.route('/api/backup')
def backup_all_data():
    """Download all data files as a zip archive."""
    buffer = BytesIO()

    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Add all schedule files
        for term in VALID_TERMS:
            schedule_file = get_schedule_file(term)
            if os.path.exists(schedule_file):
                filename = os.path.basename(schedule_file)
                with open(schedule_file, 'r') as f:
                    zf.writestr(filename, f.read())

        # Add course history
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, 'r') as f:
                zf.writestr('course_history.json', f.read())

    buffer.seek(0)

    return send_file(
        buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'scheduler_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.zip'
    )


@app.route('/api/restore', methods=['POST'])
def restore_data():
    """Restore data from uploaded zip file. Requires password."""
    password = request.form.get('password', '')

    if password != RESET_PASSWORD:
        return jsonify({'success': False, 'error': 'Invalid password'}), 401

    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file uploaded'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400

    if not file.filename.endswith('.zip'):
        return jsonify({'success': False, 'error': 'File must be a .zip archive'}), 400

    try:
        # Save to temp file and extract
        with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name

        restored_files = []

        with zipfile.ZipFile(tmp_path, 'r') as zf:
            for name in zf.namelist():
                # Only allow specific JSON files
                if name in ['schedule.json', 'schedule_spring_2027.json', 'course_history.json']:
                    content = zf.read(name)
                    # Validate it's valid JSON
                    json.loads(content)

                    target_path = os.path.join(DATA_DIR, name)
                    os.makedirs(os.path.dirname(target_path), exist_ok=True)
                    with open(target_path, 'wb') as f:
                        f.write(content)
                    restored_files.append(name)

        # Clean up temp file
        os.unlink(tmp_path)

        # Broadcast update to all clients
        socketio.emit('data_restored', {
            'files': restored_files,
            'timestamp': datetime.now().isoformat()
        }, broadcast=True)

        return jsonify({'success': True, 'restored': restored_files})

    except json.JSONDecodeError:
        return jsonify({'success': False, 'error': 'Invalid JSON in zip file'}), 400
    except zipfile.BadZipFile:
        return jsonify({'success': False, 'error': 'Invalid zip file'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@socketio.on('connect')
def handle_connect():
    """Handle new WebSocket connection."""
    print(f'Client connected: {request.sid}')
    emit('connected', {'status': 'connected', 'sid': request.sid})


@socketio.on('disconnect')
def handle_disconnect():
    """Handle WebSocket disconnection."""
    print(f'Client disconnected: {request.sid}')


@socketio.on('move_course')
def handle_move_course(data):
    """Handle course move from client."""
    term = data.get('term', DEFAULT_TERM)
    schedule = load_schedule(term)

    course_id = data.get('courseId')
    new_slot_id = data.get('slotId')

    for course in schedule['courses']:
        if course['id'] == course_id:
            course['slotId'] = new_slot_id
            break

    save_schedule(schedule, term)

    emit('schedule_update', {
        'courseId': course_id,
        'slotId': new_slot_id,
        'term': term,
        'timestamp': datetime.now().isoformat()
    }, broadcast=True)


@socketio.on('request_sync')
def handle_sync_request(data=None):
    """Send full schedule to requesting client."""
    term = DEFAULT_TERM
    if data and isinstance(data, dict):
        term = data.get('term', DEFAULT_TERM)
    emit('full_sync', load_schedule(term))


if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5001, use_reloader=False, allow_unsafe_werkzeug=True)
