import json
import os
from datetime import datetime
from io import BytesIO

from flask import Flask, render_template, jsonify, request, send_file
from flask_socketio import SocketIO, emit
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

async_mode = 'eventlet' if os.environ.get('RENDER') else 'threading'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode=async_mode)

DATA_FILE = os.path.join(os.path.dirname(__file__), 'data', 'schedule.json')


def load_schedule():
    """Load schedule data from JSON file."""
    try:
        with open(DATA_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {"courses": [], "instructors": [], "timeSlots": {}}


def save_schedule(data):
    """Save schedule data to JSON file."""
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)


@app.route('/')
def index():
    """Serve the main schedule page."""
    return render_template('index.html')


@app.route('/api/schedule')
def get_schedule():
    """Return current schedule data."""
    return jsonify(load_schedule())


@app.route('/api/schedule', methods=['POST'])
def update_schedule():
    """Update schedule and broadcast to all clients."""
    data = request.json
    schedule = load_schedule()

    course_id = data.get('courseId')
    new_slot_id = data.get('slotId')

    for course in schedule['courses']:
        if course['id'] == course_id:
            course['slotId'] = new_slot_id
            break

    save_schedule(schedule)

    socketio.emit('schedule_update', {
        'courseId': course_id,
        'slotId': new_slot_id,
        'timestamp': datetime.now().isoformat()
    })

    return jsonify({'success': True})


@app.route('/api/course', methods=['POST'])
def update_course():
    """Update course details."""
    data = request.json
    schedule = load_schedule()

    course_id = data.get('courseId')
    updates = data.get('updates', {})

    for course in schedule['courses']:
        if course['id'] == course_id:
            for key, value in updates.items():
                if key in course:
                    course[key] = value
            break

    save_schedule(schedule)

    socketio.emit('course_update', {
        'courseId': course_id,
        'updates': updates,
        'timestamp': datetime.now().isoformat()
    })

    return jsonify({'success': True})


@app.route('/api/course/add', methods=['POST'])
def add_course():
    """Add a new course."""
    data = request.json
    schedule = load_schedule()

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
    save_schedule(schedule)

    socketio.emit('course_added', {
        'course': new_course,
        'timestamp': datetime.now().isoformat()
    }, broadcast=True)

    return jsonify({'success': True, 'course': new_course})


@app.route('/api/faculty', methods=['GET'])
def get_faculty():
    """Get all faculty members."""
    schedule = load_schedule()
    return jsonify(schedule.get('faculty', []))


@app.route('/api/faculty/add', methods=['POST'])
def add_faculty():
    """Add a new faculty member."""
    data = request.json
    schedule = load_schedule()

    name = data.get('name', '').strip()
    if not name:
        return jsonify({'success': False, 'error': 'Name is required'}), 400

    if 'faculty' not in schedule:
        schedule['faculty'] = []

    if name not in schedule['faculty']:
        schedule['faculty'].append(name)
        schedule['faculty'].sort()
        save_schedule(schedule)

        socketio.emit('faculty_added', {
            'name': name,
            'timestamp': datetime.now().isoformat()
        }, broadcast=True)

    return jsonify({'success': True, 'name': name})


@app.route('/api/faculty/delete', methods=['POST'])
def delete_faculty():
    """Delete a faculty member."""
    data = request.json
    schedule = load_schedule()

    name = data.get('name', '')
    if 'faculty' in schedule and name in schedule['faculty']:
        schedule['faculty'].remove(name)
        save_schedule(schedule)

        socketio.emit('faculty_deleted', {
            'name': name,
            'timestamp': datetime.now().isoformat()
        }, broadcast=True)

    return jsonify({'success': True})


@app.route('/api/undo', methods=['POST'])
def undo_action():
    """Undo a previous action."""
    data = request.json
    schedule = load_schedule()
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

        save_schedule(schedule)

        socketio.emit('schedule_update', {
            'courseId': course_id,
            'slotId': slot_id,
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

        save_schedule(schedule)

        socketio.emit('course_update', {
            'courseId': course_id,
            'updates': updates,
            'timestamp': datetime.now().isoformat()
        }, broadcast=True)

    elif action_type == 'delete':
        course_id = data.get('courseId')
        schedule['courses'] = [c for c in schedule['courses'] if c['id'] != course_id]
        save_schedule(schedule)

        socketio.emit('course_deleted', {
            'courseId': course_id,
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
    schedule = load_schedule()

    course_id = data.get('courseId')
    new_slot_id = data.get('slotId')

    for course in schedule['courses']:
        if course['id'] == course_id:
            course['slotId'] = new_slot_id
            break

    save_schedule(schedule)

    emit('schedule_update', {
        'courseId': course_id,
        'slotId': new_slot_id,
        'timestamp': datetime.now().isoformat()
    }, broadcast=True)


@socketio.on('request_sync')
def handle_sync_request():
    """Send full schedule to requesting client."""
    emit('full_sync', load_schedule())


if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5001, use_reloader=False, allow_unsafe_werkzeug=True)
