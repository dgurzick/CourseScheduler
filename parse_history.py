#!/usr/bin/env python3
"""Parse class info.txt to extract course history data."""
import re
import json

def parse_class_info(filename):
    with open(filename, 'r') as f:
        content = f.read()

    # Course name mapping
    course_names = {}
    # Course history
    course_history = {}

    # Pattern to match course entries
    # Format: "CODE NUMBER: Course Name"
    course_pattern = r'^((?:MGMT|ECON|ECMG|ACCT|ITMG|LEAD|CAMG) \d+): (.+?)$'
    year_pattern = r'Year: (\d+) \| Term: (\w+)'
    section_pattern = r'Section: (\d+)'
    instructor_pattern = r'^([A-Z][a-z]+(?:-[A-Z][a-z]+)?, [A-Z][a-z]+(?:\s*;\s*[A-Za-z/]+)?)'

    lines = content.split('\n')
    i = 0
    current_course = None
    current_name = None

    while i < len(lines):
        line = lines[i].strip()

        # Check for course code and name
        match = re.match(course_pattern, line)
        if match:
            code_num = match.group(1)  # e.g., "ECON 205"
            name = match.group(2)       # e.g., "Principles of Macroeconomics"

            # Skip "See" references
            if not name.startswith('See '):
                current_course = code_num.replace(' ', '-')
                current_name = name

                # Store the canonical name (first occurrence)
                if code_num not in course_names:
                    course_names[code_num] = name

                if current_course not in course_history:
                    course_history[current_course] = {
                        'code': code_num.split()[0],
                        'number': code_num.split()[1],
                        'name': name,
                        'offerings': []
                    }

        # Check for year/term
        year_match = re.search(year_pattern, line)
        if year_match and current_course:
            year = year_match.group(1)
            term = year_match.group(2)

            # Look for section on next line
            section = '01'
            if i + 1 < len(lines):
                sect_match = re.search(section_pattern, lines[i+1])
                if sect_match:
                    section = sect_match.group(1)

            # Look for instructor (usually a few lines down)
            instructor = ''
            for j in range(i+1, min(i+10, len(lines))):
                inst_match = re.match(instructor_pattern, lines[j].strip())
                if inst_match:
                    instructor = inst_match.group(1).split(';')[0].strip()
                    # Simplify to last name
                    if ',' in instructor:
                        instructor = instructor.split(',')[0]
                    break
                # Also check for "Instructor has not yet been assigned"
                if 'Instructor has not yet been assigned' in lines[j]:
                    instructor = 'TBA'
                    break

            # Add to history if not a duplicate
            offering = {
                'year': int(year),
                'term': term,
                'section': section,
                'instructor': instructor
            }

            # Check for duplicate
            is_dup = False
            for existing in course_history[current_course]['offerings']:
                if (existing['year'] == offering['year'] and
                    existing['term'] == offering['term'] and
                    existing['section'] == offering['section']):
                    is_dup = True
                    break

            if not is_dup:
                course_history[current_course]['offerings'].append(offering)

        i += 1

    # Sort offerings by year (descending), then term
    term_order = {'Fall': 2, 'Spring': 1, 'Summer': 0}
    for course_id in course_history:
        course_history[course_id]['offerings'].sort(
            key=lambda x: (x['year'], term_order.get(x['term'], 0)),
            reverse=True
        )

    return course_names, course_history

def update_schedule_names(schedule_file, course_names):
    """Update the schedule.json with correct course names."""
    with open(schedule_file, 'r') as f:
        schedule = json.load(f)

    # Name mapping based on extracted data
    name_map = {
        'ECON 205': 'Principles of Macroeconomics',
        'ECON 206': 'Principles of Microeconomics',
        'ECON 306': 'Microeconomic Analysis',
        'ECON 309': 'Monetary Policy & Financial Markets',
        'ECON 310': 'Environmental Economics',
        'ECON 316': 'Game Theory',
        'ECON 452': 'History of Economic Thought',
        'ECON 480': 'Econometrics',
        'ECON 551': 'Foundations of Economics',
        'ECON 560': 'Managerial Economics',
        'ECMG 300': 'Financial Economics',
        'ECMG 303': 'Principles of Finance & Investment',
        'MGMT 205': 'Prin of Mgmt & Intro to Organizations',
        'MGMT 281': 'Principles of Financial Accounting',
        'MGMT 284': 'Principles of Managerial Accounting',
        'MGMT 301': 'Organizational Theory and Behavior',
        'MGMT 306': 'Principles of Marketing',
        'MGMT 312': 'Analytical Methods of Management',
        'MGMT 314': 'International Business',
        'MGMT 315': 'Managing Nonprofit Organizations',
        'MGMT 321': 'Intermediate Accounting I',
        'MGMT 370': 'Investment Practicum',
        'MGMT 399': 'Internship in Management',
        'MGMT 402': 'Business Finance',
        'MGMT 406': 'Consumer Behavior and Analysis',
        'MGMT 411': 'Seminar in Strategic Management',
        'MGMT 423': 'Marketing Research Methods',
        'MGMT 432': 'Advanced Accounting',
        'MGMT 454': 'Legal Environment of Business',
        'MGMT 476': 'Strategic Management',
        'MGMT 550': 'Business Analytics',
        'MGMT 552': 'Quantitative Methods for Managers',
        'MGMT 562': 'Financial & Managerial Accounting',
        'MGMT 564': 'Production & Operations Management',
        'MGMT 566': 'Information Management & Technology',
        'MGMT 570': 'Marketing Analysis for Managers',
        'MGMT 576': 'Business Analytics',
        'MGMT 580': 'Strategic Cost Management',
        'MGMT 582': 'Negotiation & Conflict Resolution',
        'ITMG 388': 'Management Information Systems',
        'LEAD 628': 'Leadership Development',
        'LEAD 669': 'Project Management',
    }

    # Update course names
    for course in schedule['courses']:
        key = f"{course['code']} {course['number']}"
        if key in name_map:
            course['name'] = name_map[key]

    return schedule

if __name__ == '__main__':
    import os
    base_dir = os.path.dirname(__file__)

    # Parse class info
    course_names, course_history = parse_class_info(os.path.join(base_dir, 'class info.txt'))

    # Save course history
    with open(os.path.join(base_dir, 'data', 'course_history.json'), 'w') as f:
        json.dump(course_history, f, indent=2)

    # Update schedule names
    schedule = update_schedule_names(os.path.join(base_dir, 'data', 'schedule.json'), course_names)
    with open(os.path.join(base_dir, 'data', 'schedule.json'), 'w') as f:
        json.dump(schedule, f, indent=2)

    print(f"Processed {len(course_history)} unique courses")
    print(f"Updated schedule.json with correct names")
