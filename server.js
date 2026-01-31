const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load environment variables from .env file
try {
    const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    envFile.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            process.env[key.trim()] = valueParts.join('=').trim();
        }
    });
} catch (e) {
    console.log('.env file not found, using environment variables');
}

// OpenAI API Key (set via environment variable)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Function to generate AI summary using OpenAI
async function generateAISummary(userData) {
    try {
        const topThree = userData.topThreeCode.split('');
        const topTypes = topThree.map(t => riasecExtended[t].name).join(', ');
        
        const prompt = `You are a professional career counselor. Generate a personalized 3-4 sentence career summary for this person based on their RIASEC assessment results.

Personal Profile:
- Name: ${userData.fullName}
- Age: ${userData.age || 'Not specified'} years
- Gender: ${userData.gender || 'Not specified'}
- Education: ${userData.education ? userData.education.replace('_', ' ') : 'Not specified'}
- Occupation: ${userData.occupation || 'Not specified'}
- Location: ${userData.location || 'Not specified'}

RIASEC Assessment Results:
- Holland Code: ${userData.topThreeCode} (${topTypes})
- Top interest type: ${riasecExtended[topThree[0]].name} - ${riasecExtended[topThree[0]].description}
- Second interest type: ${riasecExtended[topThree[1]].name} - ${riasecExtended[topThree[1]].description}
- Third interest type: ${riasecExtended[topThree[2]].name} - ${riasecExtended[topThree[2]].description}

Write a warm, personalized summary that:
1. Addresses them by name
2. Connects their background (education/occupation) to their results
3. Explains what their Holland Code means for their career path
4. Gives encouragement about their potential

Keep it professional but friendly. Write in second person (you/your). Maximum 4 sentences.`;

        return new Promise((resolve) => {
            const requestData = JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a professional career counselor providing personalized career guidance.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 300,
                temperature: 0.7
            });

            const options = {
                hostname: 'api.openai.com',
                port: 443,
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Length': Buffer.byteLength(requestData)
                }
            };

            const req = https.request(options, (res) => {
                let responseData = '';
                res.on('data', chunk => responseData += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
                            resolve(parsed.choices[0].message.content.trim());
                        } else {
                            console.error('OpenAI response error:', responseData);
                            resolve(generateFallbackSummary(userData));
                        }
                    } catch (e) {
                        console.error('Error parsing OpenAI response:', e);
                        resolve(generateFallbackSummary(userData));
                    }
                });
            });

            req.on('error', (e) => {
                console.error('OpenAI request error:', e);
                resolve(generateFallbackSummary(userData));
            });

            req.setTimeout(10000, () => {
                console.error('OpenAI request timeout');
                req.destroy();
                resolve(generateFallbackSummary(userData));
            });

            req.write(requestData);
            req.end();
        });
    } catch (error) {
        console.error('Error in generateAISummary:', error);
        return generateFallbackSummary(userData);
    }
}

// Fallback summary if AI fails
function generateFallbackSummary(userData) {
    if (!userData || !userData.topThreeCode) {
        return 'Based on your RIASEC assessment, you have a unique combination of interests that can lead to a fulfilling career. Consider exploring careers that align with your top interest areas and leverage your natural strengths.';
    }
    const topThree = userData.topThreeCode.split('');
    const topTypes = topThree.map(t => riasecExtended[t]?.name || t).join(', ');
    const name = userData.fullName || 'Based on your assessment';
    const education = userData.education ? userData.education.replace('_', ' ') : 'your field';
    return `${name}, your Holland Code ${userData.topThreeCode} reveals strong interests in ${topTypes} areas. This unique combination suggests you would excel in careers that blend these interests together. Your background in ${education} provides a solid foundation for exploring these career paths. Consider roles that allow you to combine these interests for maximum career satisfaction.`;
}

// PostgreSQL connection using Neon
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_S02yqZLxIpdz@ep-summer-night-ahegvpko-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: {
        rejectUnauthorized: false
    }
});

// Initialize database tables
async function initDatabase() {
    try {
        // Main quiz results table with status tracking
        await pool.query(`
            CREATE TABLE IF NOT EXISTS quiz_results (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) UNIQUE,
                full_name VARCHAR(255),
                email VARCHAR(255),
                phone VARCHAR(50),
                age INTEGER,
                gender VARCHAR(20),
                education VARCHAR(100),
                occupation VARCHAR(255),
                location VARCHAR(255),
                answers JSONB,
                scores JSONB,
                top_three_code VARCHAR(10),
                time_taken INTEGER,
                status VARCHAR(20) DEFAULT 'incomplete',
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                user_agent TEXT,
                ip_address VARCHAR(45)
            )
        `);
        
        // Add status column if it doesn't exist (for existing tables)
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name='quiz_results' AND column_name='status') THEN
                    ALTER TABLE quiz_results ADD COLUMN status VARCHAR(20) DEFAULT 'incomplete';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name='quiz_results' AND column_name='started_at') THEN
                    ALTER TABLE quiz_results ADD COLUMN started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END $$;
        `);
        
        console.log('Database tables initialized');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

// Generate session ID
function generateSessionId() {
    return 'quiz_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Admin credentials (in production, use environment variables and hashed passwords)
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin';

// Simple session management for admin
const adminSessions = new Set();

function generateAdminToken() {
    return 'admin_' + Date.now() + '_' + Math.random().toString(36).substr(2, 16);
}

// RIASEC descriptions for PDF
const riasecDescriptions = {
    R: { name: 'Realistic', nepali: 'यथार्थवादी', careers: 'Engineer, Mechanic, Electrician, Carpenter, Farmer' },
    I: { name: 'Investigative', nepali: 'अन्वेषणात्मक', careers: 'Scientist, Researcher, Doctor, Professor, Analyst' },
    A: { name: 'Artistic', nepali: 'कलात्मक', careers: 'Artist, Designer, Writer, Musician, Actor' },
    S: { name: 'Social', nepali: 'सामाजिक', careers: 'Teacher, Counselor, Nurse, Social Worker, HR Manager' },
    E: { name: 'Enterprising', nepali: 'उद्यमशील', careers: 'Manager, Salesperson, Lawyer, Entrepreneur, Politician' },
    C: { name: 'Conventional', nepali: 'परम्परागत', careers: 'Accountant, Administrator, Banker, Data Analyst, Secretary' }
};

// MIME types
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf'
};

// Parse JSON body from request
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

// Check admin authentication from cookie
function isAdminAuthenticated(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/adminToken=([^;]+)/);
    if (match && adminSessions.has(match[1])) {
        return true;
    }
    return false;
}

// Company branding configuration (can be updated by admin)
const companyBranding = {
    name: 'Just Connect',
    nameNepali: 'जस्ट कनेक्ट',
    website: 'https://justconnect.online/',
    email: 'info@justconnect.online',
    phone: '+977-1-XXXXXXX',
    logoUrl: '/Document.svg',
    tagline: 'Empowering Your Career Journey',
    taglineNepali: 'तपाईंको क्यारियर यात्रामा सशक्तिकरण'
};

// Extended RIASEC descriptions for professional report - Based on RIASEC Detailed PDF and RIASEC Occupations
const riasecExtended = {
    R: {
        name: 'Realistic', nepali: 'यथार्थवादी', icon: '🔧', color: '#dc2626', colorLight: '#fef2f2',
        subtitle: 'The Doers', subtitleNepali: 'कार्यकर्ता',
        focus: 'Things & Order',
        description: 'People who have athletic or mechanical ability, prefer to work with objects, machines, tools, plants or animals, or to be outdoors. Technically & Athletically Inclined people have mechanical ingenuity and prefer to work on their own using their hands and tools to build, repair, grow, or make things, often outdoors.',
        descriptionNepali: 'यथार्थवादी व्यक्तिहरूले विचार वा मानिसहरू भन्दा चीजहरूसँग काम गर्न रुचाउँछन्। तिनीहरूले हातले काम गर्न, निर्माण गर्न, मर्मत गर्न र बाहिर काम गर्न मन पराउँछन्।',
        traits: ['Practical', 'Athletic', 'Straightforward/Frank', 'Mechanically inclined', 'Nature lover', 'Thrifty', 'Curious about the physical world', 'Stable', 'Concrete', 'Reserved', 'Self-controlled', 'Independent', 'Ambitious', 'Systematic', 'Persistent'],
        abilities: ['Fix electrical things', 'Solve electrical problems', 'Pitch a tent', 'Play a sport', 'Read a blueprint', 'Plant a garden', 'Operate tools and machinery'],
        likes: ['Tinker with machines/vehicles', 'Work outdoors', 'Use your hands', 'Be physically active', 'Build things', 'Tend/train animals', 'Work on electronic equipment'],
        hobbies: ['Refinishing furniture', 'Growing plants/flowers', 'Playing sports, hunting, fishing', 'Woodworking', 'Coaching team sports', 'Building models', 'Repairing cars, equipment', 'Target shooting', 'Landscaping', 'Taking exercise classes'],
        strengths: ['Practical problem-solving', 'Physical coordination', 'Working with tools', 'Building & repairing', 'Mechanical ingenuity', 'Athletic ability'],
        collegeMajors: ['Agriculture', 'Health Assistant', 'Computers', 'Construction', 'Mechanic/Machinist', 'Engineering', 'Food and Hospitality'],
        relatedPathways: ['Natural Resources', 'Health Services', 'Industrial and Engineering Technology', 'Arts and Communication'],
        careers: ['Aerospace Engineer', 'Aircraft Mechanic', 'Automotive Mechanic', 'Baker/Chef', 'Carpenter', 'Civil Engineer', 'Construction Worker', 'Dental Laboratory Technician', 'Diesel Mechanic', 'Electrician', 'Electrical Engineer', 'Farmer', 'Firefighter', 'Forester', 'HVAC Technician', 'Industrial Machinery Mechanic', 'Jeweler', 'Laboratory Technician', 'Landscape Worker', 'Machinist', 'Mechanical Engineer', 'Pilot', 'Plumber', 'Police Officer', 'Practical Nurse', 'Quality Control Manager', 'Surveyor', 'Tool and Die Maker', 'Truck Driver', 'Welder', 'Veterinary Technician'],
        occupationsExtended: ['Aerospace Engineering Technicians', 'Agricultural Equipment Operators', 'Agricultural Technicians', 'Aircraft Mechanics and Service Technicians', 'Airline Pilots, Copilots, and Flight Engineers', 'Athletes and Sports Competitors', 'Automotive Body Repairers', 'Automotive Master Mechanics', 'Aviation Inspectors', 'Bakers', 'Brickmasons', 'Broadcast Technicians', 'Bus and Truck Mechanics', 'Cabinetmakers', 'Camera Operators', 'Cardiovascular Technologists', 'Cement Masons', 'Chemical Plant Operators', 'Civil Drafters', 'Civil Engineering Technicians', 'Civil Engineers', 'Commercial Pilots', 'Computer Support Specialists', 'Construction Laborers', 'Cooks (Restaurant/Chef)', 'Correctional Officers', 'Crane Operators', 'Dental Laboratory Technicians', 'Electrical Drafters', 'Electrical Engineering Technicians', 'Electrical Power-Line Installers', 'Electricians', 'Elevator Installers', 'Environmental Engineering Technicians', 'Farm Equipment Mechanics', 'Farmers and Ranchers', 'Fence Erectors', 'Firefighters', 'Fish and Game Wardens', 'Floor Layers', 'Food Science Technicians', 'Forest and Conservation Workers', 'Foresters', 'Glaziers', 'Hazardous Materials Removal Workers', 'Heating and Air Conditioning Mechanics', 'Highway Maintenance Workers', 'Industrial Machinery Mechanics', 'Jewelers', 'Landscaping Workers', 'Locksmiths', 'Locomotive Engineers', 'Logging Equipment Operators', 'Machinists', 'Maintenance Workers', 'Mechanical Drafters', 'Mechanical Engineering Technicians', 'Medical Equipment Preparers', 'Medical Equipment Repairers', 'Millwrights', 'Mobile Heavy Equipment Mechanics', 'Motorcycle Mechanics', 'Nuclear Power Reactor Operators', 'Painters', 'Pest Control Workers', 'Petroleum Pump Operators', 'Plumbers', 'Police Patrol Officers', 'Power Plant Operators', 'Printing Machine Operators', 'Radiologic Technicians', 'Railroad Engineers', 'Recreational Vehicle Technicians', 'Refrigeration Mechanics', 'Roofers', 'Security Guards', 'Sheet Metal Workers', 'Stationary Engineers', 'Structural Iron Workers', 'Surgical Technologists', 'Surveyors', 'Tailors', 'Taxi Drivers', 'Telecommunications Installers', 'Tool and Die Makers', 'Transportation Inspectors', 'Tree Trimmers', 'Truck Drivers', 'Upholsterers', 'Veterinary Technicians', 'Watch Repairers', 'Water Treatment Plant Operators', 'Welders', 'Woodworking Machine Operators']
    },
    I: {
        name: 'Investigative', nepali: 'अन्वेषणात्मक', icon: '🔬', color: '#2563eb', colorLight: '#eff6ff',
        subtitle: 'The Thinkers', subtitleNepali: 'विचारक',
        focus: 'Ideas and Things',
        description: 'People who like to observe, learn, investigate, analyze, evaluate or solve problems. Abstract Problem Solvers prefer to work on their own, using their minds to observe, learn, investigate, research and solve abstract problems, frequently in a scientifically related area.',
        descriptionNepali: 'अन्वेषणात्मक व्यक्तिहरूले अनुसन्धान गर्न, विश्लेषण गर्न र जटिल समस्याहरू समाधान गर्न रमाउँछन्। तिनीहरू जिज्ञासु, विश्लेषणात्मक र स्वतन्त्र रूपमा काम गर्न रुचाउँछन्।',
        traits: ['Inquisitive', 'Analytical', 'Scientific', 'Observant', 'Precise', 'Scholarly', 'Cautious', 'Intellectually self-confident', 'Introspective', 'Reserved', 'Broad-minded', 'Independent', 'Logical', 'Complex', 'Curious'],
        abilities: ['Think abstractly', 'Solve math problems', 'Understand scientific theories', 'Do complex calculations', 'Use a microscope or computer', 'Interpret formulas'],
        likes: ['Explore a variety of ideas', 'Use computers', 'Work independently', 'Perform lab experiments', 'Read scientific or technical journals', 'Analyze data', 'Deal with abstractions', 'Do research', 'Be challenged'],
        hobbies: ['Book club', 'Astronomy', 'Crossword puzzles/board games', 'Preservation of endangered species', 'Computers', 'Visiting museums', 'Collecting rocks, stamps, coins, etc.', 'Amateur Radio', 'Recreational flying'],
        strengths: ['Critical thinking', 'Research skills', 'Data analysis', 'Scientific reasoning', 'Abstract problem-solving', 'Mathematical ability'],
        collegeMajors: ['Marine Biology', 'Engineering', 'Chemistry', 'Zoology', 'Medicine/Surgery', 'Consumer Economics', 'Psychology'],
        relatedPathways: ['Health Services', 'Business', 'Public and Human Services', 'Industrial and Engineering Technology'],
        careers: ['Actuary', 'Agronomist', 'Anesthesiologist', 'Anthropologist', 'Archeologist', 'Biochemist', 'Biologist', 'Chemical Engineer', 'Chemist', 'Chiropractor', 'Civil Engineer', 'Computer Engineer', 'Computer Programmer', 'Computer Systems Analyst', 'Dentist', 'Ecologist', 'Economist', 'Electrical Engineer', 'Geologist', 'Mathematician', 'Medical Lab Technologist', 'Meteorologist', 'Nurse Practitioner', 'Pharmacist', 'Physician', 'Psychologist', 'Research Analyst', 'Software Engineer', 'Statistician', 'Technical Writer', 'Veterinarian', 'Web Developer'],
        occupationsExtended: ['Aerospace Engineers', 'Agricultural Engineers', 'Anesthesiologists', 'Animal Scientists', 'Anthropologists', 'Archeologists', 'Astronomers', 'Atmospheric Scientists', 'Audiologists', 'Biochemists and Biophysicists', 'Biologists', 'Biomedical Engineers', 'Chemical Engineers', 'Chemical Technicians', 'Chemists', 'Clinical Psychologists', 'Computer and Information Scientists', 'Computer Hardware Engineers', 'Computer Programmers', 'Computer Software Engineers', 'Computer Systems Analysts', 'Coroners', 'Dentists', 'Diagnostic Medical Sonographers', 'Dietitians and Nutritionists', 'Economists', 'Electrical Engineers', 'Electronics Engineers', 'Environmental Engineers', 'Environmental Scientists', 'Epidemiologists', 'Family and General Practitioners', 'Fire Investigators', 'Food Scientists', 'Forensic Science Technicians', 'Geographers', 'Geoscientists', 'Historians', 'Hydrologists', 'Industrial Engineers', 'Industrial-Organizational Psychologists', 'Internists', 'Management Analysts', 'Marine Architects', 'Marine Engineers', 'Market Research Analysts', 'Materials Engineers', 'Materials Scientists', 'Mathematicians', 'Mechanical Engineers', 'Medical and Clinical Laboratory Technologists', 'Medical Scientists', 'Microbiologists', 'Mining Engineers', 'Network Systems Administrators', 'Nuclear Engineers', 'Nuclear Medicine Technologists', 'Obstetricians and Gynecologists', 'Operations Research Analysts', 'Optometrists', 'Orthodontists', 'Pediatricians', 'Petroleum Engineers', 'Pharmacists', 'Physicists', 'Podiatrists', 'Political Scientists', 'Prosthodontists', 'Psychiatrists', 'School Psychologists', 'Sociologists', 'Software Quality Assurance Engineers', 'Soil Scientists', 'Surgeons', 'Survey Researchers', 'Urban and Regional Planners', 'Veterinarians', 'Zoologists and Wildlife Biologists']
    },
    A: {
        name: 'Artistic', nepali: 'कलात्मक', icon: '🎨', color: '#7c3aed', colorLight: '#f5f3ff',
        subtitle: 'The Creators', subtitleNepali: 'सिर्जनाकर्ता',
        focus: 'Ideas & Feelings',
        description: 'People who have artistic, innovating or intuitional abilities and like to work in unstructured situations using their imagination and creativity. Idea Creators enjoy working with little supervision, innovating, problem-solving imaginatively, enjoy artistic expression, and creating, most often in the performing, visual and literary arts.',
        descriptionNepali: 'कलात्मक व्यक्तिहरूले आत्म-अभिव्यक्ति र सिर्जनशीलतालाई महत्व दिन्छन्। तिनीहरूले असंरचित वातावरणमा काम गर्न रुचाउँछन् जहाँ तिनीहरू नवीन र मौलिक हुन सक्छन्।',
        traits: ['Creative', 'Intuitive', 'Imaginative', 'Innovative', 'Unconventional', 'Emotional', 'Independent', 'Expressive', 'Original', 'Introspective', 'Impulsive', 'Sensitive', 'Courageous', 'Open', 'Complicated', 'Idealistic', 'Nonconforming'],
        abilities: ['Sketch, draw, paint', 'Play a musical instrument', 'Write stories, poetry, music', 'Sing, act, dance', 'Design fashions or interiors'],
        likes: ['Attend concerts, theatres, art exhibits', 'Read fiction, plays, and poetry', 'Work on crafts', 'Take photographs', 'Express yourself creatively', 'Deal with ambiguous ideas'],
        hobbies: ['Photography', 'Performing', 'Writing stories, poems', 'Desktop publishing', 'Sewing', 'Taking dance lessons', 'Visiting art museums', 'Designing sets for plays', 'Travel', 'Playing a musical instrument', 'Homemade crafts', 'Painting', 'Speaking foreign languages'],
        strengths: ['Creativity', 'Imagination', 'Artistic expression', 'Original thinking', 'Innovation', 'Visual/aesthetic sense'],
        collegeMajors: ['Communications', 'Cosmetology', 'Fine and Performing Arts', 'Photography', 'Radio and TV', 'Interior Design', 'Architecture'],
        relatedPathways: ['Public and Human Services', 'Arts and Communication'],
        careers: ['Actor/Actress', 'Advertising Art Director', 'Advertising Manager', 'Architect', 'Clothing/Fashion Designer', 'Copywriter', 'Dancer', 'Choreographer', 'Drama Teacher', 'English Teacher', 'Fashion Illustrator', 'Furniture Designer', 'Graphic Designer', 'Interior Designer', 'Journalist/Reporter', 'Landscape Architect', 'Medical Illustrator', 'Museum Curator', 'Music Teacher', 'Photographer', 'Writer/Editor'],
        occupationsExtended: ['Actors', 'Architects', 'Architectural Drafters', 'Art Directors', 'Broadcast News Analysts', 'Choreographers', 'Commercial and Industrial Designers', 'Craft Artists', 'Dancers', 'Desktop Publishers', 'Editors', 'Fashion Designers', 'Film and Video Editors', 'Fine Artists (Painters, Sculptors, Illustrators)', 'Floral Designers', 'Graphic Designers', 'Hairdressers and Cosmetologists', 'Interior Designers', 'Interpreters and Translators', 'Landscape Architects', 'Makeup Artists', 'Merchandise Displayers', 'Models', 'Multi-Media Artists and Animators', 'Music Composers and Arrangers', 'Music Directors', 'Musicians', 'Photographers', 'Poets and Creative Writers', 'Radio and Television Announcers', 'Reporters and Correspondents', 'Set and Exhibit Designers', 'Singers', 'Technical Writers']
    },
    S: {
        name: 'Social', nepali: 'सामाजिक', icon: '🤝', color: '#059669', colorLight: '#ecfdf5',
        subtitle: 'The Helpers', subtitleNepali: 'सहायक',
        focus: 'People & Feelings',
        description: 'People who like to work with people to enlighten, inform, help, train, or cure them, or are skilled with words. People Helpers like to work with people to inform, enlighten, help, train, develop or cure them.',
        descriptionNepali: 'सामाजिक व्यक्तिहरूले मानिसहरूसँग काम गर्न, मद्दत गर्न, सिकाउन र परामर्श दिन रमाउँछन्। तिनीहरूसँग बलियो अन्तरव्यक्तिगत सीपहरू छन्।',
        traits: ['Friendly', 'Helpful', 'Idealistic', 'Insightful', 'Outgoing', 'Understanding', 'Cooperative', 'Generous', 'Responsible', 'Forgiving', 'Patient', 'Empathic', 'Kind', 'Persuasive'],
        abilities: ['Teach/train others', 'Express yourself clearly', 'Lead a group discussion', 'Mediate disputes', 'Plan and supervise an activity', 'Cooperate well with others'],
        likes: ['Work in groups', 'Help people with problems', 'Participate in meetings', 'Do volunteer work', 'Work with young people', 'Play team sports', 'Serve others'],
        hobbies: ['Volunteering with social action groups', 'Writing letters', 'Joining campus or community organizations', 'Helping others with personal concerns', 'Meeting new friends', 'Attending sporting events', 'Caring for children', 'Religious activities', 'Going to parties', 'Playing team sports'],
        strengths: ['Empathy', 'Communication', 'Teaching ability', 'Conflict resolution', 'Interpersonal skills', 'Patience'],
        collegeMajors: ['Counseling', 'Nursing', 'Physical Therapy', 'Travel', 'Advertising', 'Public Relations', 'Education'],
        relatedPathways: ['Health Services', 'Public and Human Services'],
        careers: ['Air Traffic Controller', 'Athletic Trainer', 'Chaplain', 'City Manager', 'College Professor', 'Community Planner', 'Counseling Psychologist', 'Counselor/Therapist', 'Cosmetologist', 'Dental Hygienist', 'Dietitian', 'Elementary School Teacher', 'High School Teacher', 'Historian', 'Home Economist', 'Hospital Administrator', 'Librarian', 'Medical Assistant', 'Minister/Priest/Rabbi', 'Nurse/Midwife', 'Occupational Therapist', 'Paralegal', 'Park Naturalist', 'Personnel Recruiter', 'Physical Therapist', 'Police Officer', 'Preschool Worker', 'Probation Officer', 'Social Worker'],
        occupationsExtended: ['Adult Literacy Teachers', 'Agricultural Sciences Teachers', 'Anthropology Teachers', 'Arbitrators and Mediators', 'Architecture Teachers', 'Art, Drama, and Music Teachers', 'Athletic Trainers', 'Biological Science Teachers', 'Business Teachers', 'Chemistry Teachers', 'Child Care Workers', 'Child and Family Social Workers', 'Chiropractors', 'Clergy', 'Coaches and Scouts', 'Communications Teachers', 'Computer Science Teachers', 'Concierges', 'Counseling Psychologists', 'Criminal Justice Teachers', 'Dental Hygienists', 'Dietetic Technicians', 'Economics Teachers', 'Education Administrators', 'Educational Counselors', 'Elementary School Teachers', 'Emergency Management Specialists', 'Emergency Medical Technicians', 'English Language Teachers', 'Environmental Science Teachers', 'Farm and Home Management Advisors', 'Fitness Trainers', 'Foreign Language Teachers', 'Forestry Teachers', 'Funeral Attendants', 'Geography Teachers', 'Graduate Teaching Assistants', 'Health Educators', 'Health Specialties Teachers', 'History Teachers', 'Home Economics Teachers', 'Home Health Aides', 'Instructional Coordinators', 'Kindergarten Teachers', 'Law Teachers', 'Library Science Teachers', 'Licensed Practical Nurses', 'Marriage and Family Therapists', 'Massage Therapists', 'Mathematical Science Teachers', 'Medical and Public Health Social Workers', 'Medical Assistants', 'Mental Health Counselors', 'Middle School Teachers', 'Nannies', 'Nursing Aides', 'Nursing Teachers', 'Occupational Therapists', 'Park Naturalists', 'Personal Care Aides', 'Philosophy Teachers', 'Physical Therapists', 'Physical Therapist Assistants', 'Physician Assistants', 'Physics Teachers', 'Political Science Teachers', 'Preschool Teachers', 'Probation Officers', 'Psychiatric Technicians', 'Psychology Teachers', 'Public Address Announcers', 'Radiation Therapists', 'Recreation Workers', 'Recreational Therapists', 'Registered Nurses', 'Rehabilitation Counselors', 'Residential Advisors', 'Respiratory Therapists', 'Secondary School Teachers', 'Self-Enrichment Teachers', 'Social Work Teachers', 'Sociology Teachers', 'Special Education Teachers', 'Speech-Language Pathologists', 'Substance Abuse Counselors', 'Teacher Assistants', 'Tour Guides', 'Training Specialists', 'Vocational Education Teachers', 'Waiters and Waitresses']
    },
    E: {
        name: 'Enterprising', nepali: 'उद्यमशील', icon: '💼', color: '#d97706', colorLight: '#fffbeb',
        subtitle: 'The Persuaders', subtitleNepali: 'प्रभावकारी',
        focus: 'People & Leaders',
        description: 'People who like to work with others and enjoy persuading and performing. People Influencers like to work with people actively influencing, leading or managing them toward organizational goals. Comfortable in business settings.',
        descriptionNepali: 'उद्यमशील व्यक्तिहरू प्राकृतिक नेता हुन् जसले मनाउन, व्यवस्थापन गर्न र अरूलाई प्रेरित गर्न रमाउँछन्। तिनीहरू महत्वाकांक्षी र प्रतिस्पर्धी छन्।',
        traits: ['Ambitious', 'Adventurous', 'Assertive', 'Energetic', 'Enthusiastic', 'Confident', 'Optimistic', 'Sociable', 'Persuasive', 'Competitive', 'Risk-taking', 'Dominant', 'Extroverted'],
        abilities: ['Lead people', 'Sell things or promote ideas', 'Give talks or speeches', 'Organize activities', 'Manage people and projects', 'Make quick decisions'],
        likes: ['Influence others', 'Run for office', 'Start your own business', 'Make decisions affecting others', 'Be elected to office', 'Win awards', 'Be in a position of power'],
        hobbies: ['Public speaking', 'Debating', 'Leading organizations', 'Campaigning', 'Starting businesses', 'Networking', 'Community leadership', 'Organizing events', 'Fundraising', 'Competitive activities'],
        strengths: ['Leadership', 'Persuasion', 'Risk-taking', 'Decision making', 'Public speaking', 'Negotiation'],
        collegeMajors: ['Fashion Merchandising', 'Real Estate', 'Marketing/Sales', 'Law', 'Political Science', 'International Trade', 'Banking/Finance'],
        relatedPathways: ['Business', 'Public and Human Services', 'Arts and Communication'],
        careers: ['Administrative Services Manager', 'Advertising Manager', 'Advertising Sales Agent', 'Agent/Business Manager', 'Air Traffic Controller', 'Bartender', 'Chef and Head Cook', 'Chief Executive', 'Computer and Information Systems Manager', 'Construction Manager', 'Copy Writer', 'Criminal Investigator', 'Curator', 'Customer Service Representative', 'Director', 'Education Administrator', 'Employment Interviewer', 'Engineering Manager', 'Financial Manager', 'Funeral Director', 'Gaming Manager', 'General Operations Manager', 'Human Resources Manager', 'Insurance Sales Agent', 'Judge', 'Lawyer', 'Legislator', 'Loan Counselor', 'Lodging Manager', 'Logistician', 'Marketing Manager', 'Medical Services Manager', 'Meeting Planner', 'Natural Sciences Manager', 'Personal Financial Advisor', 'Personnel Recruiter', 'Private Investigator', 'Producer', 'Property Manager', 'Public Relations Manager', 'Purchasing Manager', 'Real Estate Broker', 'Retail Salesperson', 'Sales Manager', 'Sales Engineer', 'Sheriff', 'Social Services Manager', 'Training Manager', 'Transportation Manager', 'Travel Agent'],
        occupationsExtended: ['Administrative Law Judges', 'Administrative Services Managers', 'Advertising and Promotions Managers', 'Advertising Sales Agents', 'Agents and Business Managers of Artists', 'Air Traffic Controllers', 'Aircraft Cargo Handling Supervisors', 'Amusement and Recreation Attendants', 'Appraisers', 'Bartenders', 'Chefs and Head Cooks', 'Chief Executives', 'Compensation Managers', 'Computer and Information Systems Managers', 'Construction Managers', 'Copy Writers', 'Criminal Investigators', 'Crop and Livestock Managers', 'Curators', 'Customer Service Representatives', 'Demonstrators and Product Promoters', 'Directors (Stage, Motion Pictures, TV, Radio)', 'Education Administrators', 'Employment Interviewers', 'Engineering Managers', 'Financial Examiners', 'Financial Managers', 'First-Line Supervisors/Managers', 'Flight Attendants', 'Food Service Managers', 'Funeral Directors', 'Gaming Managers', 'General and Operations Managers', 'Hotel/Restaurant Hosts and Hostesses', 'Human Resources Managers', 'Industrial Production Managers', 'Insurance Sales Agents', 'Judges and Magistrates', 'Lawyers', 'Legislators', 'Loan Counselors', 'Lodging Managers', 'Logisticians', 'Marketing Managers', 'Medical and Health Services Managers', 'Meeting and Convention Planners', 'Natural Sciences Managers', 'Opticians', 'Personal Financial Advisors', 'Personnel Recruiters', 'Police Detectives', 'Postmasters', 'Private Detectives', 'Producers', 'Program Directors', 'Property Managers', 'Public Relations Managers', 'Public Relations Specialists', 'Purchasing Managers', 'Railroad Conductors', 'Real Estate Brokers', 'Real Estate Sales Agents', 'Retail Salespersons', 'Sales Agents (Financial/Securities)', 'Sales Engineers', 'Sales Managers', 'Sales Representatives', 'Sheriffs', 'Ship Captains', 'Social and Community Service Managers', 'Storage and Distribution Managers', 'Talent Directors', 'Technical Directors', 'Telemarketers', 'Training Managers', 'Transportation Managers', 'Travel Agents', 'Wholesale Buyers']
    },
    C: {
        name: 'Conventional', nepali: 'परम्परागत', icon: '📊', color: '#0891b2', colorLight: '#ecfeff',
        subtitle: 'The Organizers', subtitleNepali: 'संगठनकर्ता',
        focus: 'Detail & Order',
        description: 'People who are very detail oriented, organized and like to work with data. Data and Detail People prefer to work with data (words and numbers), carrying out detailed instructions or following a prescribed plan.',
        descriptionNepali: 'परम्परागत व्यक्तिहरूले संगठित गर्न, डेटा व्यवस्थापन गर्न र स्थापित प्रक्रियाहरू पालना गर्नमा उत्कृष्ट हुन्छन्। तिनीहरू विस्तारमुखी र भरपर्दो छन्।',
        traits: ['Careful', 'Conforming', 'Conscientious', 'Detail-oriented', 'Efficient', 'Orderly', 'Organized', 'Persistent', 'Practical', 'Precise', 'Responsible', 'Structured', 'Systematic', 'Thrifty'],
        abilities: ['Work well within a system', 'Do a lot of paperwork in a short time', 'Use computers', 'Keep accurate records', 'Write business letters', 'Follow detailed instructions'],
        likes: ['Work with numbers', 'Have a clear set of rules to follow', 'Type or take notes', 'Follow directions', 'Be responsible for details', 'Collect or organize things'],
        hobbies: ['Collecting things', 'Organizing files', 'Keeping records', 'Doing puzzles', 'Playing card games', 'Maintaining schedules', 'Budgeting finances', 'Computer activities', 'Reading instruction manuals'],
        strengths: ['Organization', 'Attention to detail', 'Data management', 'Following procedures', 'Accuracy', 'Reliability'],
        collegeMajors: ['Accounting', 'Court Reporting', 'Insurance', 'Administration', 'Medical Records', 'Banking', 'Data Processing'],
        relatedPathways: ['Health Services', 'Business', 'Industrial and Engineering Technology'],
        careers: ['Accountant', 'Actuary', 'Archivist', 'Assessor', 'Auditor', 'Bookkeeper', 'Budget Analyst', 'Cashier', 'Claims Examiner', 'Cost Estimator', 'Court Reporter', 'Credit Analyst', 'Data Entry Keyer', 'Database Administrator', 'Dental Assistant', 'Dispatcher', 'Executive Secretary', 'File Clerk', 'Financial Analyst', 'Human Resources Assistant', 'Insurance Claims Clerk', 'Insurance Underwriter', 'Legal Secretary', 'Librarian', 'Loan Officer', 'Medical Records Technician', 'Medical Secretary', 'Payroll Clerk', 'Pharmacy Technician', 'Postal Service Clerk', 'Receptionist', 'Secretary', 'Statistical Assistant', 'Statistician', 'Tax Examiner', 'Tax Preparer', 'Teller', 'Web Developer'],
        occupationsExtended: ['Accountants', 'Actuaries', 'Archivists', 'Assessors', 'Audio-Visual Collections Specialists', 'Auditors', 'Bill and Account Collectors', 'Billing Clerks', 'Bookkeeping Clerks', 'Brokerage Clerks', 'Budget Analysts', 'Cargo and Freight Agents', 'Cashiers', 'City and Regional Planning Aides', 'Claims Examiners', 'Compensation and Benefits Specialists', 'Computer Operators', 'Computer Security Specialists', 'Correspondence Clerks', 'Cost Estimators', 'Costume Attendants', 'Counter and Rental Clerks', 'Court Clerks', 'Court Reporters', 'Credit Analysts', 'Credit Authorizers', 'Credit Checkers', 'Data Entry Keyers', 'Database Administrators', 'Dental Assistants', 'Dispatchers', 'Electronic Drafters', 'Environmental Compliance Inspectors', 'Executive Secretaries', 'File Clerks', 'Financial Analysts', 'Fire Inspectors', 'Gaming and Sports Book Writers', 'Gaming Cage Workers', 'Gaming Dealers', 'Geophysical Data Technicians', 'Government Property Inspectors', 'Hotel and Motel Desk Clerks', 'Human Resources Assistants', 'Immigration Inspectors', 'Inspectors and Testers', 'Insurance Adjusters', 'Insurance Appraisers', 'Insurance Claims Clerks', 'Insurance Policy Processing Clerks', 'Insurance Underwriters', 'Interviewers', 'Job Printers', 'Law Clerks', 'Legal Secretaries', 'Librarians', 'Library Assistants', 'Library Technicians', 'License Clerks', 'Licensing Examiners', 'Loan Interviewers', 'Loan Officers', 'Mail Clerks', 'Mapping Technicians', 'Marking Clerks', 'Medical Records Technicians', 'Medical Secretaries', 'Medical Transcriptionists', 'Meter Readers', 'Municipal Clerks', 'Network Designers', 'New Accounts Clerks', 'Numerical Tool Programmers', 'Occupational Health and Safety Technicians', 'Office Clerks', 'Order Clerks', 'Order Fillers', 'Paralegals', 'Payroll Clerks', 'Pharmacy Aides', 'Pharmacy Technicians', 'Police Identification Officers', 'Postal Service Clerks', 'Postal Service Mail Carriers', 'Procurement Clerks', 'Production Clerks', 'Proofreaders', 'Purchasing Agents', 'Receptionists', 'Reservation Agents', 'Sales Representatives', 'Secretaries', 'Shipping Clerks', 'Social and Human Service Assistants', 'Social Science Research Assistants', 'Statement Clerks', 'Statistical Assistants', 'Statisticians', 'Stock Clerks', 'Switchboard Operators', 'Tax Examiners', 'Tax Preparers', 'Telephone Operators', 'Tellers', 'Title Examiners', 'Treasurers and Controllers', 'Web Administrators', 'Web Developers', 'Word Processors']
    }
};

// Generate Professional Multi-Page PDF Report
async function generatePDFContent(data) {
    const scores = data.scores;
    const topThree = data.topThreeCode.split('');
    const sortedTypes = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const maxScore = 7;
    const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    
    // Generate AI-powered personalized summary
    const aiSummary = await generateAISummary(data);
    
    // Build Holland Code letters HTML
    const hollandLettersHTML = topThree.map(t => 
        `<div class="cover-code-letter">${t}</div>`
    ).join('');
    
    // Build Holland letters with labels
    const hollandLettersLabeled = topThree.map(t => 
        `<div class="holland-letter">${t}<span class="holland-letter-label">${riasecExtended[t].name}</span></div>`
    ).join('');
    
    // Build Holland meaning
    const hollandMeaning = topThree.map(t => riasecExtended[t].name).join(' - ') + 
        ' (' + topThree.map(t => riasecExtended[t].nepali).join(' - ') + ')';
    
    // Build score rows
    const scoreRowsHTML = sortedTypes.map(([type, score], index) => {
        const info = riasecExtended[type];
        const isTop = index < 3;
        const rankBadge = isTop ? `<span class="rank-badge">#${index + 1}</span>` : '';
        const percentage = (score / maxScore) * 100;
        
        return `<div class="score-row ${isTop ? 'top' : ''}">
            <span class="score-icon">${info.icon}</span>
            <div class="score-info">
                <div class="score-name">${info.name}${rankBadge}</div>
                <div class="score-name-nepali">${info.nepali}</div>
            </div>
            <div class="score-bar-wrap">
                <div class="score-bar-bg"><div class="score-bar-fill" style="width:${percentage}%;background:${info.color};"></div></div>
                <div class="score-val">${score} out of ${maxScore}</div>
            </div>
            <div class="score-num">${score}</div>
        </div>`;
    }).join('');
    
    // Build type detail pages with comprehensive RIASEC data
    const typeDetailPages = topThree.map((type, idx) => {
        const info = riasecExtended[type];
        const strengthsHTML = info.strengths.map(s => 
            `<div class="strength"><span class="strength-check">✓</span><span>${s}</span></div>`
        ).join('');
        const traitsHTML = info.traits.slice(0, 8).map(t => 
            `<span class="trait-tag">${t}</span>`
        ).join('');
        const abilitiesHTML = info.abilities.map(a => 
            `<div class="ability-item"><span class="ability-check">✓</span><span>${a}</span></div>`
        ).join('');
        const likesHTML = info.likes.map(l => 
            `<div class="like-item"><span class="like-icon">♥</span><span>${l}</span></div>`
        ).join('');
        const hobbiesHTML = info.hobbies.slice(0, 6).map(h => 
            `<span class="hobby-tag">${h}</span>`
        ).join('');
        const collegeMajorsHTML = info.collegeMajors.map(m => 
            `<span class="major-tag" style="background:${info.colorLight};color:${info.color};border:1px solid ${info.color}40;">${m}</span>`
        ).join('');
        const pathwaysHTML = info.relatedPathways.map(p => 
            `<span class="pathway-tag">${p}</span>`
        ).join('');
        const careersHTML = info.careers.slice(0, 12).map(c => 
            `<span class="career-tag" style="background:${info.colorLight};color:${info.color};border:1px solid ${info.color}40;">${c}</span>`
        ).join('');
        const extendedOccupationsHTML = info.occupationsExtended.slice(0, 20).map(o => 
            `<span class="occupation-tag">${o}</span>`
        ).join('');
        
        // Page 1 for this type: Overview, Traits, Abilities
        const page1 = `<div class="page">
        <div class="content">
            <div class="page-header">
                <img src="${companyBranding.logoUrl}" alt="Logo" class="page-logo" onerror="this.style.display='none'">
                <div class="page-title"><h2>Your #${idx + 1} Interest Type: ${info.name}</h2><p>${data.fullName} • ${reportDate}</p></div>
            </div>
            <div class="type-card" style="border-color:${info.color};">
                <div class="type-header" style="background:${info.colorLight};">
                    <div class="type-icon" style="background:${info.color};color:white;">${info.icon}</div>
                    <div class="type-info">
                        <h3 style="color:${info.color};">${info.name} (${type}) - ${info.subtitle}</h3>
                        <div class="subtitle">${info.subtitleNepali} • Focus: ${info.focus} • Score: ${scores[type]}/${maxScore}</div>
                    </div>
                </div>
                <div class="type-body">
                    <div class="type-desc">
                        <strong>Description:</strong> ${info.description}<br><br>
                        <strong>नेपाली:</strong> ${info.descriptionNepali}
                    </div>
                    
                    <div class="type-subsection">
                        <h4>🧠 Personality Traits - Are You?</h4>
                        <div class="traits-wrap">${traitsHTML}</div>
                    </div>
                    
                    <div class="type-subsection">
                        <h4>💪 Key Strengths</h4>
                        <div class="strengths-grid">${strengthsHTML}</div>
                    </div>
                    
                    <div class="type-subsection">
                        <h4>🎯 Can You? (Abilities)</h4>
                        <div class="abilities-grid">${abilitiesHTML}</div>
                    </div>
                    
                    <div class="type-subsection">
                        <h4>❤️ You Like To...</h4>
                        <div class="likes-grid">${likesHTML}</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="page-footer">
            <div class="footer-left"><img src="${companyBranding.logoUrl}" alt="Logo" class="footer-logo" onerror="this.style.display='none'"><span>${companyBranding.name} • ${companyBranding.website}</span></div>
            <div>Page ${(idx * 2) + 3}</div>
        </div>
    </div>`;
        
        // Page 2 for this type: Hobbies, Education, Careers
        const page2 = `<div class="page">
        <div class="content">
            <div class="page-header">
                <img src="${companyBranding.logoUrl}" alt="Logo" class="page-logo" onerror="this.style.display='none'">
                <div class="page-title"><h2>${info.name} - Career Pathways</h2><p>${data.fullName} • ${reportDate}</p></div>
            </div>
            <div class="type-card" style="border-color:${info.color};">
                <div class="type-header" style="background:${info.colorLight};">
                    <div class="type-icon" style="background:${info.color};color:white;">${info.icon}</div>
                    <div class="type-info">
                        <h3 style="color:${info.color};">${info.name} (${type}) - Career Guide</h3>
                        <div class="subtitle">Education & Career Recommendations</div>
                    </div>
                </div>
                <div class="type-body">
                    <div class="type-subsection">
                        <h4>🎨 Hobbies & Interests</h4>
                        <div class="hobbies-wrap">${hobbiesHTML}</div>
                    </div>
                    
                    <div class="type-subsection">
                        <h4>🎓 Recommended College Majors</h4>
                        <div class="majors-wrap">${collegeMajorsHTML}</div>
                    </div>
                    
                    <div class="type-subsection">
                        <h4>🛤️ Related Career Pathways</h4>
                        <div class="pathways-wrap">${pathwaysHTML}</div>
                    </div>
                    
                    <div class="type-subsection">
                        <h4>💼 Top Career Options</h4>
                        <div class="careers-wrap">${careersHTML}</div>
                    </div>
                    
                    <div class="type-subsection">
                        <h4>📋 Extended Occupation List</h4>
                        <div class="occupations-wrap">${extendedOccupationsHTML}</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="page-footer">
            <div class="footer-left"><img src="${companyBranding.logoUrl}" alt="Logo" class="footer-logo" onerror="this.style.display='none'"><span>${companyBranding.name} • ${companyBranding.website}</span></div>
            <div>Page ${(idx * 2) + 4}</div>
        </div>
    </div>`;
        
        return page1 + page2;
    }).join('');
    
    // Build summary cards
    const summaryCardsHTML = topThree.map(t => {
        const info = riasecExtended[t];
        return `<div class="summary-card" style="background:${info.colorLight};border-color:${info.color};">
            <div class="summary-card-icon">${info.icon}</div>
            <div class="summary-card-letter" style="color:${info.color};">${t}</div>
            <div class="summary-card-name">${info.name}</div>
        </div>`;
    }).join('');
    
    // Education display
    const educationDisplay = data.education ? data.education.replace('_', ' ').toUpperCase() : 'Student';
    const locationDisplay = data.location || 'Nepal';
    const genderDisplay = data.gender === 'male' ? 'Male' : data.gender === 'female' ? 'Female' : 'Other';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Career Assessment Report - ${data.fullName}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        @page { size: A4; margin: 0; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', -apple-system, sans-serif; background: #f1f5f9; color: #1e293b; line-height: 1.6; font-size: 14px; }
        .page { width: 210mm; min-height: 297mm; margin: 20px auto; background: white; position: relative; box-shadow: 0 4px 20px rgba(0,0,0,0.1); page-break-after: always; }
        @media print { body { background: white; } .page { margin: 0; box-shadow: none; } .no-print { display: none !important; } * { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
        .cover { background: linear-gradient(135deg, #0f172a 0%, #1e40af 50%, #3b82f6 100%); color: white; display: flex; flex-direction: column; min-height: 297mm; }
        .cover-header { padding: 30px 40px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.15); }
        .cover-logo { width: 100px; height: 100px; border-radius: 16px; background: white; padding: 8px; object-fit: contain; }
        .cover-company { text-align: right; }
        .cover-company-name { font-size: 20px; font-weight: 700; }
        .cover-company-tagline { font-size: 12px; opacity: 0.8; }
        .cover-main { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 40px; }
        .cover-icon { font-size: 70px; margin-bottom: 25px; }
        .cover-title { font-size: 38px; font-weight: 800; margin-bottom: 8px; letter-spacing: -1px; }
        .cover-subtitle { font-size: 18px; opacity: 0.9; margin-bottom: 45px; }
        .cover-student { background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); border-radius: 16px; padding: 28px 45px; border: 1px solid rgba(255,255,255,0.2); }
        .cover-student-name { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
        .cover-student-info { font-size: 13px; opacity: 0.8; }
        .cover-code-preview { margin-top: 35px; }
        .cover-code-label { font-size: 13px; opacity: 0.7; margin-bottom: 12px; }
        .cover-code-letters { display: flex; gap: 12px; justify-content: center; }
        .cover-code-letter { width: 60px; height: 60px; background: white; color: #1e40af; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 800; }
        .cover-footer { padding: 20px 40px; border-top: 1px solid rgba(255,255,255,0.15); display: flex; justify-content: space-between; font-size: 11px; opacity: 0.7; }
        .content { padding: 35px 40px 80px; }
        .page-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 18px; border-bottom: 2px solid #e2e8f0; margin-bottom: 25px; }
        .page-logo { height: 60px; border-radius: 10px; }
        .page-title h2 { font-size: 20px; font-weight: 700; color: #1e40af; }
        .page-title p { font-size: 11px; color: #64748b; }
        .section { margin-bottom: 25px; }
        .section-title { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 700; color: #1e40af; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 2px solid #3b82f6; }
        .section-icon { font-size: 20px; }
        .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; background: #f8fafc; padding: 20px; border-radius: 10px; border: 1px solid #e2e8f0; }
        .info-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 2px; }
        .info-value { font-size: 14px; font-weight: 500; color: #1e293b; }
        .ai-summary { background: linear-gradient(135deg, #eff6ff, #dbeafe); padding: 22px; border-radius: 12px; border: 1px solid #93c5fd; margin-bottom: 22px; }
        .ai-summary-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; color: #1e40af; margin-bottom: 12px; }
        .ai-summary p { font-size: 14px; line-height: 1.8; color: #1e40af; }
        .holland-section { background: linear-gradient(135deg, #0f172a 0%, #1e40af 100%); border-radius: 14px; padding: 28px; color: white; text-align: center; margin-bottom: 25px; }
        .holland-title { font-size: 14px; opacity: 0.9; margin-bottom: 15px; }
        .holland-letters { display: flex; justify-content: center; gap: 15px; margin-bottom: 15px; }
        .holland-letter { width: 70px; height: 70px; background: white; color: #1e40af; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 30px; font-weight: 800; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .holland-letter-label { font-size: 8px; font-weight: 600; margin-top: 2px; color: #64748b; }
        .holland-meaning { font-size: 12px; opacity: 0.8; }
        .scores-list { display: flex; flex-direction: column; gap: 10px; }
        .score-row { display: flex; align-items: center; gap: 12px; padding: 12px 15px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; }
        .score-row.top { background: linear-gradient(90deg, #eff6ff, #dbeafe); border-color: #93c5fd; }
        .score-icon { font-size: 24px; width: 35px; text-align: center; }
        .score-info { flex: 1; }
        .score-name { font-weight: 600; font-size: 14px; color: #1e293b; }
        .score-name-nepali { font-size: 11px; color: #64748b; }
        .score-bar-wrap { width: 160px; }
        .score-bar-bg { height: 10px; background: #e2e8f0; border-radius: 5px; overflow: hidden; margin-bottom: 3px; }
        .score-bar-fill { height: 100%; border-radius: 5px; }
        .score-val { font-size: 10px; color: #64748b; text-align: right; }
        .score-num { font-size: 20px; font-weight: 700; color: #1e40af; min-width: 35px; text-align: center; }
        .rank-badge { background: #3b82f6; color: white; font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 3px; margin-left: 6px; }
        .type-card { background: white; border-radius: 14px; border: 2px solid #e2e8f0; overflow: hidden; margin-bottom: 20px; page-break-inside: avoid; }
        .type-header { padding: 18px 22px; display: flex; align-items: center; gap: 15px; }
        .type-icon { width: 55px; height: 55px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 28px; }
        .type-info h3 { font-size: 20px; font-weight: 700; margin-bottom: 2px; }
        .type-info .subtitle { font-size: 12px; opacity: 0.7; }
        .type-body { padding: 0 22px 22px; }
        .type-desc { font-size: 13px; line-height: 1.7; color: #475569; margin-bottom: 18px; padding: 12px; background: #f8fafc; border-radius: 8px; }
        .type-subsection { margin-bottom: 15px; }
        .type-subsection h4 { font-size: 13px; font-weight: 600; color: #1e40af; margin-bottom: 10px; }
        .strengths-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        .strength { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #f1f5f9; border-radius: 6px; font-size: 12px; }
        .strength-check { color: #059669; font-weight: bold; }
        .traits-wrap { display: flex; flex-wrap: wrap; gap: 6px; }
        .trait-tag { padding: 5px 10px; background: #e0e7ff; color: #3730a3; border-radius: 12px; font-size: 11px; font-weight: 500; }
        .abilities-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
        .ability-item { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: #ecfdf5; border-radius: 6px; font-size: 11px; }
        .ability-check { color: #059669; font-weight: bold; }
        .likes-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
        .like-item { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: #fef2f2; border-radius: 6px; font-size: 11px; }
        .like-icon { color: #dc2626; }
        .hobbies-wrap { display: flex; flex-wrap: wrap; gap: 6px; }
        .hobby-tag { padding: 5px 10px; background: #fdf4ff; color: #7c3aed; border-radius: 12px; font-size: 11px; font-weight: 500; }
        .majors-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
        .major-tag { padding: 6px 12px; border-radius: 15px; font-size: 11px; font-weight: 500; }
        .pathways-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
        .pathway-tag { padding: 6px 12px; background: #fef3c7; color: #92400e; border-radius: 15px; font-size: 11px; font-weight: 500; }
        .careers-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
        .career-tag { padding: 6px 12px; border-radius: 15px; font-size: 11px; font-weight: 500; }
        .occupations-wrap { display: flex; flex-wrap: wrap; gap: 5px; }
        .occupation-tag { padding: 4px 8px; background: #f1f5f9; color: #475569; border-radius: 10px; font-size: 10px; }
        .page-footer { position: absolute; bottom: 0; left: 0; right: 0; padding: 15px 40px; background: linear-gradient(135deg, #1e40af, #3b82f6); display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: white; }
        .footer-left { display: flex; align-items: center; gap: 10px; }
        .footer-logo { height: 30px; border-radius: 6px; }
        .summary-box { background: linear-gradient(135deg, #eff6ff, #dbeafe); padding: 22px; border-radius: 12px; border: 1px solid #93c5fd; margin-bottom: 22px; }
        .summary-box p { font-size: 15px; line-height: 1.8; color: #1e40af; }
        .summary-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 25px; }
        .summary-card { text-align: center; padding: 18px; border-radius: 10px; border: 2px solid; }
        .summary-card-icon { font-size: 32px; margin-bottom: 8px; }
        .summary-card-letter { font-size: 22px; font-weight: 800; }
        .summary-card-name { font-size: 11px; color: #64748b; }
        .steps-list { display: flex; flex-direction: column; gap: 12px; }
        .step-item { display: flex; gap: 12px; align-items: flex-start; padding: 14px; background: #f8fafc; border-radius: 8px; border-left: 4px solid; }
        .step-icon { font-size: 20px; }
        .step-content strong { color: #1e40af; font-size: 14px; }
        .step-content p { color: #64748b; font-size: 12px; margin-top: 4px; }
        .contact-box { background: linear-gradient(135deg, #0f172a 0%, #1e40af 100%); color: white; padding: 25px; border-radius: 14px; text-align: center; margin-top: 25px; }
        .contact-box h3 { font-size: 18px; margin-bottom: 12px; }
        .contact-box p { opacity: 0.9; margin-bottom: 15px; font-size: 13px; }
        .contact-info { display: flex; justify-content: center; gap: 25px; flex-wrap: wrap; font-size: 12px; }
        .print-btn { position: fixed; bottom: 25px; right: 25px; background: linear-gradient(135deg, #3b82f6, #1e40af); color: white; border: none; padding: 14px 28px; border-radius: 50px; font-size: 15px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 18px rgba(59, 130, 246, 0.4); display: flex; align-items: center; gap: 8px; z-index: 1000; }
        .print-btn:hover { transform: translateY(-2px); }
    </style>
</head>
<body>
    <!-- COVER PAGE -->
    <div class="page cover">
        <div class="cover-header">
            <img src="${companyBranding.logoUrl}" alt="Logo" class="cover-logo" onerror="this.style.display='none'">
            <div class="cover-company">
                <div class="cover-company-name">${companyBranding.name}</div>
                <div class="cover-company-tagline">${companyBranding.tagline}</div>
            </div>
        </div>
        <div class="cover-main">
            <div class="cover-icon">📊</div>
            <h1 class="cover-title">Career Assessment Report</h1>
            <p class="cover-subtitle">RIASEC / Holland Code Interest Inventory</p>
            <div class="cover-student">
                <div class="cover-student-name">${data.fullName}</div>
                <div class="cover-student-info">${educationDisplay} • ${locationDisplay}</div>
            </div>
            <div class="cover-code-preview">
                <div class="cover-code-label">Your Holland Code</div>
                <div class="cover-code-letters">${hollandLettersHTML}</div>
            </div>
        </div>
        <div class="cover-footer">
            <div>Report Date: ${reportDate}</div>
            <div>${companyBranding.website}</div>
        </div>
    </div>
    
    <!-- PAGE 2: PROFILE & SCORES -->
    <div class="page">
        <div class="content">
            <div class="page-header">
                <img src="${companyBranding.logoUrl}" alt="Logo" class="page-logo" onerror="this.style.display='none'">
                <div class="page-title"><h2>Profile & Results</h2><p>${data.fullName} • ${reportDate}</p></div>
            </div>
            <div class="section">
                <div class="section-title"><span class="section-icon">👤</span>Personal Information</div>
                <div class="info-grid">
                    <div class="info-item"><span class="info-label">Full Name</span><span class="info-value">${data.fullName}</span></div>
                    <div class="info-item"><span class="info-label">Email</span><span class="info-value">${data.email || 'N/A'}</span></div>
                    <div class="info-item"><span class="info-label">Phone</span><span class="info-value">${data.phone || 'N/A'}</span></div>
                    <div class="info-item"><span class="info-label">Age</span><span class="info-value">${data.age || 'N/A'} years</span></div>
                    <div class="info-item"><span class="info-label">Gender</span><span class="info-value">${genderDisplay}</span></div>
                    <div class="info-item"><span class="info-label">Education</span><span class="info-value">${data.education ? data.education.replace('_', ' ') : 'N/A'}</span></div>
                    <div class="info-item"><span class="info-label">Occupation</span><span class="info-value">${data.occupation || 'N/A'}</span></div>
                    <div class="info-item"><span class="info-label">Location</span><span class="info-value">${data.location || 'N/A'}</span></div>
                </div>
            </div>
            <div class="section">
                <div class="ai-summary">
                    <div class="ai-summary-title"><span>✨</span>Personalized Summary</div>
                    <p>${aiSummary}</p>
                </div>
            </div>
            <div class="holland-section">
                <div class="holland-title">Your Holland Code / तपाईंको होल्याण्ड कोड</div>
                <div class="holland-letters">${hollandLettersLabeled}</div>
                <div class="holland-meaning">${hollandMeaning}</div>
            </div>
            <div class="section">
                <div class="section-title"><span class="section-icon">📈</span>RIASEC Score Breakdown</div>
                <div class="scores-list">${scoreRowsHTML}</div>
            </div>
        </div>
        <div class="page-footer">
            <div class="footer-left"><img src="${companyBranding.logoUrl}" alt="Logo" class="footer-logo" onerror="this.style.display='none'"><span>${companyBranding.name} • ${companyBranding.website}</span></div>
            <div>Page 2</div>
        </div>
    </div>
    
    <!-- TYPE DETAIL PAGES -->
    ${typeDetailPages}
    
    <!-- SUMMARY PAGE -->
    <div class="page">
        <div class="content">
            <div class="page-header">
                <img src="${companyBranding.logoUrl}" alt="Logo" class="page-logo" onerror="this.style.display='none'">
                <div class="page-title"><h2>Summary & Next Steps</h2><p>${data.fullName} • ${reportDate}</p></div>
            </div>
            <div class="section">
                <div class="section-title"><span class="section-icon">🎯</span>Your Career Direction Summary</div>
                <div class="summary-box">
                    <p>Based on your Holland Code <strong style="font-size:18px;">${topThree.join('')}</strong>, you show strong interests in <strong>${topThree.map(t => riasecExtended[t].name).join(', ')}</strong> areas. This suggests you would thrive in careers that combine these interests.</p>
                </div>
                <div class="summary-cards">${summaryCardsHTML}</div>
            </div>
            <div class="section">
                <div class="section-title"><span class="section-icon">📋</span>Recommended Next Steps</div>
                <div class="steps-list">
                    <div class="step-item" style="border-color:#2563eb;"><span class="step-icon">1️⃣</span><div class="step-content"><strong>Explore Career Options</strong><p>Research the recommended careers for your top interest types and learn about educational requirements.</p></div></div>
                    <div class="step-item" style="border-color:#059669;"><span class="step-icon">2️⃣</span><div class="step-content"><strong>Seek Professional Guidance</strong><p>Connect with a career counselor to discuss your results and create a personalized career plan.</p></div></div>
                    <div class="step-item" style="border-color:#d97706;"><span class="step-icon">3️⃣</span><div class="step-content"><strong>Gain Experience</strong><p>Look for internships, volunteer opportunities, or job shadowing in your areas of interest.</p></div></div>
                </div>
            </div>
            <div class="contact-box">
                <h3>Need Career Counseling?</h3>
                <p>Contact us for personalized career guidance and counseling sessions.</p>
                <div class="contact-info">
                    <div>📧 ${companyBranding.email}</div>
                    <div>📞 ${companyBranding.phone}</div>
                    <div>🌐 ${companyBranding.website}</div>
                </div>
            </div>
        </div>
        <div class="page-footer">
            <div class="footer-left"><img src="${companyBranding.logoUrl}" alt="Logo" class="footer-logo" onerror="this.style.display='none'"><span>${companyBranding.name} • ${companyBranding.website}</span></div>
            <div>Page ${(topThree.length * 2) + 3}</div>
        </div>
    </div>
    
    <button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // ============ USER REGISTRATION (tracks incomplete assessments) ============
    if (req.method === 'POST' && pathname === '/api/register-user') {
        try {
            const data = await parseBody(req);
            const sessionId = generateSessionId();
            const userAgent = req.headers['user-agent'] || 'Unknown';
            const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';

            await pool.query(
                `INSERT INTO quiz_results (
                    session_id, full_name, email, phone, age, gender, education, occupation, location,
                    status, started_at, user_agent, ip_address
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'incomplete', CURRENT_TIMESTAMP, $10, $11)`,
                [
                    sessionId,
                    data.fullName,
                    data.email,
                    data.phone,
                    data.age || null,
                    data.gender,
                    data.education,
                    data.occupation,
                    data.location,
                    userAgent,
                    ipAddress
                ]
            );

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, sessionId }));
        } catch (error) {
            console.error('Error registering user:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to register user' }));
        }
        return;
    }

    // ============ SAVE QUIZ RESULTS (marks as complete) ============
    if (req.method === 'POST' && pathname === '/api/save-quiz') {
        try {
            const data = await parseBody(req);
            const userAgent = req.headers['user-agent'] || 'Unknown';
            const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';

            if (data.sessionId) {
                // Update existing record (from registration)
                await pool.query(
                    `UPDATE quiz_results SET
                        answers = $1,
                        scores = $2,
                        top_three_code = $3,
                        time_taken = $4,
                        status = 'complete',
                        completed_at = $5
                    WHERE session_id = $6`,
                    [
                        JSON.stringify(data.answers),
                        JSON.stringify(data.scores),
                        data.topThreeCode,
                        data.timeTaken,
                        data.completedAt,
                        data.sessionId
                    ]
                );
            } else {
                // Insert new record (fallback if no session)
                const sessionId = generateSessionId();
                await pool.query(
                    `INSERT INTO quiz_results (
                        session_id, full_name, email, phone, age, gender, education, occupation, location,
                        answers, scores, top_three_code, time_taken, status, completed_at, user_agent, ip_address
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'complete', $14, $15, $16)`,
                    [
                        sessionId,
                        data.fullName,
                        data.email,
                        data.phone,
                        data.age,
                        data.gender,
                        data.education,
                        data.occupation,
                        data.location,
                        JSON.stringify(data.answers),
                        JSON.stringify(data.scores),
                        data.topThreeCode,
                        data.timeTaken,
                        data.completedAt,
                        userAgent,
                        ipAddress
                    ]
                );
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (error) {
            console.error('Error saving quiz:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to save quiz results' }));
        }
        return;
    }

    // ============ GENERATE PDF ============
    if (req.method === 'POST' && pathname === '/api/generate-pdf') {
        try {
            const data = await parseBody(req);
            const pdfHtml = await generatePDFContent(data);
            const safeName = (data.fullName || 'User').replace(/\s+/g, '_');
            
            res.writeHead(200, { 
                'Content-Type': 'text/html',
                'Content-Disposition': `attachment; filename="RIASEC_Report_${safeName}.html"`
            });
            res.end(pdfHtml);
        } catch (error) {
            console.error('Error generating PDF:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to generate PDF' }));
        }
        return;
    }

    // ============ ADMIN LOGIN ============
    if (req.method === 'POST' && pathname === '/api/admin/login') {
        try {
            const data = await parseBody(req);
            
            if (data.username === ADMIN_USERNAME && data.password === ADMIN_PASSWORD) {
                const token = generateAdminToken();
                adminSessions.add(token);
                
                res.writeHead(200, { 
                    'Content-Type': 'application/json',
                    'Set-Cookie': `adminToken=${token}; HttpOnly; Path=/; Max-Age=86400`
                });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid credentials' }));
            }
        } catch (error) {
            console.error('Error during login:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Login failed' }));
        }
        return;
    }

    // ============ ADMIN LOGOUT ============
    if (req.method === 'POST' && pathname === '/api/admin/logout') {
        const cookie = req.headers.cookie || '';
        const match = cookie.match(/adminToken=([^;]+)/);
        if (match) {
            adminSessions.delete(match[1]);
        }
        
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Set-Cookie': 'adminToken=; HttpOnly; Path=/; Max-Age=0'
        });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // ============ CHECK ADMIN AUTH ============
    if (req.method === 'GET' && pathname === '/api/admin/check-auth') {
        if (isAdminAuthenticated(req)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ authenticated: true }));
        } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ authenticated: false }));
        }
        return;
    }

    // ============ ADMIN: GET ALL RESULTS ============
    if (req.method === 'GET' && pathname === '/api/admin/results') {
        if (!isAdminAuthenticated(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        try {
            const status = url.searchParams.get('status');
            
            let query = 'SELECT * FROM quiz_results';
            let params = [];
            
            if (status) {
                query += ' WHERE status = $1';
                params.push(status);
            }
            
            query += ' ORDER BY started_at DESC';
            
            const result = await pool.query(query, params);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.rows));
        } catch (error) {
            console.error('Error fetching results:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch results' }));
        }
        return;
    }

    // ============ ADMIN: GET STATISTICS ============
    if (req.method === 'GET' && pathname === '/api/admin/stats') {
        if (!isAdminAuthenticated(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        try {
            const totalResult = await pool.query('SELECT COUNT(*) as count FROM quiz_results');
            const completeResult = await pool.query("SELECT COUNT(*) as count FROM quiz_results WHERE status = 'complete'");
            const incompleteResult = await pool.query("SELECT COUNT(*) as count FROM quiz_results WHERE status = 'incomplete'");
            const todayResult = await pool.query("SELECT COUNT(*) as count FROM quiz_results WHERE started_at >= CURRENT_DATE");
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                total: parseInt(totalResult.rows[0].count),
                complete: parseInt(completeResult.rows[0].count),
                incomplete: parseInt(incompleteResult.rows[0].count),
                today: parseInt(todayResult.rows[0].count)
            }));
        } catch (error) {
            console.error('Error fetching stats:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch statistics' }));
        }
        return;
    }

    // ============ ADMIN: DELETE RESULT ============
    if (req.method === 'POST' && pathname === '/api/admin/delete') {
        if (!isAdminAuthenticated(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        try {
            const data = await parseBody(req);
            await pool.query('DELETE FROM quiz_results WHERE id = $1', [data.id]);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (error) {
            console.error('Error deleting result:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to delete result' }));
        }
        return;
    }

    // ============ ADMIN: EXPORT CSV ============
    if (req.method === 'GET' && pathname === '/api/admin/export-csv') {
        if (!isAdminAuthenticated(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        try {
            const result = await pool.query('SELECT * FROM quiz_results ORDER BY started_at DESC');
            
            // CSV header
            const headers = [
                'ID', 'Full Name', 'Email', 'Phone', 'Age', 'Gender', 'Education', 
                'Occupation', 'Location', 'Holland Code', 'R Score', 'I Score', 
                'A Score', 'S Score', 'E Score', 'C Score', 'Status', 'Time Taken (seconds)',
                'Started At', 'Completed At'
            ];
            
            // Build CSV content
            let csv = headers.join(',') + '\n';
            
            result.rows.forEach(row => {
                const scores = row.scores || {};
                const csvRow = [
                    row.id,
                    `"${(row.full_name || '').replace(/"/g, '""')}"`,
                    `"${(row.email || '').replace(/"/g, '""')}"`,
                    `"${(row.phone || '').replace(/"/g, '""')}"`,
                    row.age || '',
                    row.gender || '',
                    row.education || '',
                    `"${(row.occupation || '').replace(/"/g, '""')}"`,
                    `"${(row.location || '').replace(/"/g, '""')}"`,
                    row.top_three_code || '',
                    scores.R || 0,
                    scores.I || 0,
                    scores.A || 0,
                    scores.S || 0,
                    scores.E || 0,
                    scores.C || 0,
                    row.status || '',
                    row.time_taken || '',
                    row.started_at ? new Date(row.started_at).toISOString() : '',
                    row.completed_at ? new Date(row.completed_at).toISOString() : ''
                ];
                csv += csvRow.join(',') + '\n';
            });
            
            const filename = `riasec_quiz_data_${new Date().toISOString().split('T')[0]}.csv`;
            
            res.writeHead(200, { 
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="${filename}"`
            });
            res.end(csv);
        } catch (error) {
            console.error('Error exporting CSV:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to export CSV' }));
        }
        return;
    }

    // ============ ADMIN: GET ANALYTICS ============
    if (req.method === 'GET' && pathname === '/api/admin/analytics') {
        if (!isAdminAuthenticated(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        try {
            // Gender distribution
            const genderStats = await pool.query(`
                SELECT gender, COUNT(*) as count 
                FROM quiz_results 
                WHERE status = 'complete' AND gender IS NOT NULL
                GROUP BY gender
            `);
            
            // Top Holland codes
            const topCodes = await pool.query(`
                SELECT top_three_code, COUNT(*) as count 
                FROM quiz_results 
                WHERE status = 'complete' AND top_three_code IS NOT NULL
                GROUP BY top_three_code 
                ORDER BY count DESC 
                LIMIT 10
            `);
            
            // Education level distribution
            const educationStats = await pool.query(`
                SELECT education, COUNT(*) as count 
                FROM quiz_results 
                WHERE status = 'complete' AND education IS NOT NULL
                GROUP BY education
            `);
            
            // Average scores by type
            const avgScores = await pool.query(`
                SELECT 
                    AVG((scores->>'R')::numeric) as r_avg,
                    AVG((scores->>'I')::numeric) as i_avg,
                    AVG((scores->>'A')::numeric) as a_avg,
                    AVG((scores->>'S')::numeric) as s_avg,
                    AVG((scores->>'E')::numeric) as e_avg,
                    AVG((scores->>'C')::numeric) as c_avg
                FROM quiz_results 
                WHERE status = 'complete' AND scores IS NOT NULL
            `);
            
            // Monthly completion trends
            const monthlyTrends = await pool.query(`
                SELECT 
                    DATE_TRUNC('month', completed_at) as month,
                    COUNT(*) as count
                FROM quiz_results 
                WHERE status = 'complete' AND completed_at IS NOT NULL
                GROUP BY DATE_TRUNC('month', completed_at)
                ORDER BY month DESC
                LIMIT 12
            `);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                genderDistribution: genderStats.rows,
                topHollandCodes: topCodes.rows,
                educationDistribution: educationStats.rows,
                averageScores: avgScores.rows[0] || {},
                monthlyTrends: monthlyTrends.rows
            }));
        } catch (error) {
            console.error('Error fetching analytics:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch analytics' }));
        }
        return;
    }

    // ============ ADMIN: GET USER REPORT ============
    if (req.method === 'GET' && pathname === '/api/admin/user-report') {
        if (!isAdminAuthenticated(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        try {
            const userId = url.searchParams.get('id');
            if (!userId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'User ID required' }));
                return;
            }

            const result = await pool.query('SELECT * FROM quiz_results WHERE id = $1', [userId]);
            
            if (result.rows.length === 0) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'User not found' }));
                return;
            }

            const row = result.rows[0];
            
            // Generate PDF report
            const pdfData = {
                fullName: row.full_name,
                email: row.email,
                phone: row.phone,
                age: row.age,
                gender: row.gender,
                education: row.education,
                occupation: row.occupation,
                location: row.location,
                scores: row.scores || {},
                topThreeCode: row.top_three_code || 'N/A'
            };

            const pdfHtml = await generatePDFContent(pdfData);
            const safeName = (row.full_name || 'User').replace(/\s+/g, '_');
            
            res.writeHead(200, { 
                'Content-Type': 'text/html',
                'Content-Disposition': `inline; filename="RIASEC_Report_${safeName}.html"`
            });
            res.end(pdfHtml);
        } catch (error) {
            console.error('Error generating user report:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to generate report' }));
        }
        return;
    }

    // ============ ADMIN: GET USER ANSWERS ============
    if (req.method === 'GET' && pathname === '/api/admin/user-answers') {
        if (!isAdminAuthenticated(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        try {
            const userId = url.searchParams.get('id');
            if (!userId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'User ID required' }));
                return;
            }

            const result = await pool.query('SELECT full_name, answers FROM quiz_results WHERE id = $1', [userId]);
            
            if (result.rows.length === 0) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'User not found' }));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                fullName: result.rows[0].full_name,
                answers: result.rows[0].answers || {}
            }));
        } catch (error) {
            console.error('Error fetching user answers:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch answers' }));
        }
        return;
    }

    // ============ SERVE STATIC FILES ============
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, filePath);

    const extname = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

const PORT = process.env.PORT || 3000;

// Initialize database and start server
initDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        console.log(`Admin panel at http://localhost:${PORT}/admin.html`);
        console.log('Quiz is ready! Open the URL in your browser.');
    });
});
