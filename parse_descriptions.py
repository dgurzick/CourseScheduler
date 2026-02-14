#!/usr/bin/env python3
"""Parse class descriptions to extract course info and offered schedules."""
import re
import json
import os

def parse_descriptions(filename):
    with open(filename, 'r') as f:
        content = f.read()

    courses = {}

    # Split by course headers (CODE NUMBER Title)
    # Pattern matches: ECON 205 Principles of Macroeconomics
    course_pattern = r'^((?:ECON|ECMG|MGMT|ITMG|LEAD|CAMG|ECPS) \d+[AB]?) (.+?)$'

    lines = content.split('\n')
    i = 0

    while i < len(lines):
        line = lines[i].strip()

        # Check for course header
        match = re.match(course_pattern, line)
        if match:
            code_num = match.group(1)  # e.g., "ECON 205"
            name = match.group(2)      # e.g., "Principles of Macroeconomics"

            # Read description (next lines until we hit Credits or another marker)
            description_lines = []
            i += 1
            while i < len(lines):
                l = lines[i].strip()
                if l == 'Credits' or l == 'Core' or l == 'Offered' or l == 'Cross Listed Courses':
                    break
                if l and not re.match(course_pattern, l):
                    description_lines.append(l)
                i += 1

            description = ' '.join(description_lines)

            # Parse remaining fields
            credits = ''
            core = ''
            offered = ''

            while i < len(lines):
                l = lines[i].strip()

                # Check if we hit a new course
                if re.match(course_pattern, l):
                    break

                if l == 'Credits':
                    i += 1
                    if i < len(lines):
                        credits = lines[i].strip()
                elif l == 'Core':
                    i += 1
                    if i < len(lines):
                        core = lines[i].strip()
                elif l == 'Offered':
                    i += 1
                    if i < len(lines):
                        offered = lines[i].strip()
                elif l == 'Cross Listed Courses':
                    i += 1  # Skip the cross-listed info
                    if i < len(lines):
                        i += 1  # Skip the description too

                i += 1

            # Store course info
            course_id = code_num.replace(' ', '-')
            courses[course_id] = {
                'code': code_num.split()[0],
                'number': code_num.split()[1] if len(code_num.split()) > 1 else '',
                'name': name,
                'description': description,
                'credits': credits,
                'core': core,
                'offered': offered
            }

            continue

        i += 1

    return courses

def update_course_history(history_file, descriptions):
    """Update course_history.json with description info."""
    with open(history_file, 'r') as f:
        history = json.load(f)

    for course_id, data in history.items():
        # Try to find matching description
        if course_id in descriptions:
            desc = descriptions[course_id]
            data['description'] = desc['description']
            data['credits'] = desc['credits']
            data['core'] = desc['core']
            data['offered'] = desc['offered']
        else:
            # Try without section suffix (e.g., MGMT-499A -> MGMT-499A)
            base_id = course_id
            if base_id in descriptions:
                desc = descriptions[base_id]
                data['description'] = desc['description']
                data['credits'] = desc['credits']
                data['core'] = desc['core']
                data['offered'] = desc['offered']

    # Save updated history
    with open(history_file, 'w') as f:
        json.dump(history, f, indent=2)

    return history

if __name__ == '__main__':
    base_dir = os.path.dirname(__file__)

    # Parse descriptions
    descriptions = parse_descriptions(os.path.join(base_dir, 'class descriptions.txt'))
    print(f"Parsed {len(descriptions)} course descriptions")

    # Show offered schedules
    print("\nOffering schedules found:")
    schedules = {}
    for course_id, data in descriptions.items():
        offered = data.get('offered', '')
        if offered:
            if offered not in schedules:
                schedules[offered] = []
            schedules[offered].append(course_id)

    for sched, courses in sorted(schedules.items()):
        print(f"  {sched}: {len(courses)} courses")

    # Update course history
    history = update_course_history(
        os.path.join(base_dir, 'data', 'course_history.json'),
        descriptions
    )
    print(f"\nUpdated {len(history)} courses in course_history.json")
