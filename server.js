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
    logoUrl: '/logo.jpeg',
    tagline: 'Empowering Your Career Journey',
    taglineNepali: 'तपाईंको क्यारियर यात्रामा सशक्तिकरण'
};

// Extended RIASEC descriptions for professional report
const riasecExtended = {
    R: {
        name: 'Realistic', nepali: 'यथार्थवादी', icon: '🔧', color: '#dc2626', colorLight: '#fef2f2',
        subtitle: 'The Doer', subtitleNepali: 'कार्यकर्ता',
        description: 'Realistic individuals prefer working with things rather than ideas or people. They enjoy hands-on activities, building, repairing, and working outdoors.',
        descriptionNepali: 'यथार्थवादी व्यक्तिहरूले विचार वा मानिसहरू भन्दा चीजहरूसँग काम गर्न रुचाउँछन्।',
        strengths: ['Practical problem-solving', 'Physical coordination', 'Working with tools', 'Building & repairing'],
        careers: ['Civil Engineer', 'Mechanic', 'Electrician', 'Carpenter', 'Pilot', 'Architect', 'Chef', 'Farmer']
    },
    I: {
        name: 'Investigative', nepali: 'अन्वेषणात्मक', icon: '🔬', color: '#2563eb', colorLight: '#eff6ff',
        subtitle: 'The Thinker', subtitleNepali: 'विचारक',
        description: 'Investigative individuals enjoy researching, analyzing, and solving complex problems. They are curious, analytical, and prefer working independently.',
        descriptionNepali: 'अन्वेषणात्मक व्यक्तिहरूले अनुसन्धान गर्न, विश्लेषण गर्न र जटिल समस्याहरू समाधान गर्न रमाउँछन्।',
        strengths: ['Critical thinking', 'Research skills', 'Data analysis', 'Scientific reasoning'],
        careers: ['Scientist', 'Doctor', 'Researcher', 'Software Developer', 'Data Analyst', 'Professor', 'Pharmacist', 'Psychologist']
    },
    A: {
        name: 'Artistic', nepali: 'कलात्मक', icon: '🎨', color: '#7c3aed', colorLight: '#f5f3ff',
        subtitle: 'The Creator', subtitleNepali: 'सिर्जनाकर्ता',
        description: 'Artistic individuals value self-expression and creativity. They prefer unstructured environments where they can be innovative and original.',
        descriptionNepali: 'कलात्मक व्यक्तिहरूले आत्म-अभिव्यक्ति र सिर्जनशीलतालाई महत्व दिन्छन्।',
        strengths: ['Creativity', 'Imagination', 'Artistic expression', 'Original thinking'],
        careers: ['Graphic Designer', 'Writer', 'Musician', 'Actor', 'Photographer', 'Interior Designer', 'Fashion Designer', 'Animator']
    },
    S: {
        name: 'Social', nepali: 'सामाजिक', icon: '🤝', color: '#059669', colorLight: '#ecfdf5',
        subtitle: 'The Helper', subtitleNepali: 'सहायक',
        description: 'Social individuals enjoy working with people, helping, teaching, and counseling. They have strong interpersonal skills.',
        descriptionNepali: 'सामाजिक व्यक्तिहरूले मानिसहरूसँग काम गर्न, मद्दत गर्न, सिकाउन र परामर्श दिन रमाउँछन्।',
        strengths: ['Empathy', 'Communication', 'Teaching ability', 'Conflict resolution'],
        careers: ['Teacher', 'Nurse', 'Counselor', 'Social Worker', 'HR Manager', 'Therapist', 'Coach', 'Public Relations']
    },
    E: {
        name: 'Enterprising', nepali: 'उद्यमशील', icon: '💼', color: '#d97706', colorLight: '#fffbeb',
        subtitle: 'The Persuader', subtitleNepali: 'प्रभावकारी',
        description: 'Enterprising individuals are natural leaders who enjoy persuading, managing, and motivating others. They are ambitious and competitive.',
        descriptionNepali: 'उद्यमशील व्यक्तिहरू प्राकृतिक नेता हुन् जसले मनाउन, व्यवस्थापन गर्न र अरूलाई प्रेरित गर्न रमाउँछन्।',
        strengths: ['Leadership', 'Persuasion', 'Risk-taking', 'Decision making'],
        careers: ['Entrepreneur', 'Manager', 'Lawyer', 'Sales Director', 'Real Estate Agent', 'Marketing Manager', 'Politician', 'CEO']
    },
    C: {
        name: 'Conventional', nepali: 'परम्परागत', icon: '📊', color: '#0891b2', colorLight: '#ecfeff',
        subtitle: 'The Organizer', subtitleNepali: 'संगठनकर्ता',
        description: 'Conventional individuals excel at organizing, managing data, and following established procedures. They are detail-oriented and reliable.',
        descriptionNepali: 'परम्परागत व्यक्तिहरूले संगठित गर्न, डेटा व्यवस्थापन गर्न र स्थापित प्रक्रियाहरू पालना गर्नमा उत्कृष्ट हुन्छन्।',
        strengths: ['Organization', 'Attention to detail', 'Data management', 'Following procedures'],
        careers: ['Accountant', 'Bank Officer', 'Administrative Assistant', 'Auditor', 'Tax Consultant', 'Secretary', 'Data Entry', 'Bookkeeper']
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
    
    // Build type detail pages
    const typeDetailPages = topThree.map((type, idx) => {
        const info = riasecExtended[type];
        const strengthsHTML = info.strengths.map(s => 
            `<div class="strength"><span class="strength-check">✓</span><span>${s}</span></div>`
        ).join('');
        const careersHTML = info.careers.map(c => 
            `<span class="career-tag" style="background:${info.colorLight};color:${info.color};border:1px solid ${info.color}40;">${c}</span>`
        ).join('');
        
        return `<div class="page">
        <div class="content">
            <div class="page-header">
                <img src="${companyBranding.logoUrl}" alt="Logo" class="page-logo" onerror="this.style.display='none'">
                <div class="page-title"><h2>Your #${idx + 1} Interest Type</h2><p>${data.fullName} • ${reportDate}</p></div>
            </div>
            <div class="type-card" style="border-color:${info.color};">
                <div class="type-header" style="background:${info.colorLight};">
                    <div class="type-icon" style="background:${info.color};color:white;">${info.icon}</div>
                    <div class="type-info">
                        <h3 style="color:${info.color};">${info.name} (${type})</h3>
                        <div class="subtitle">${info.subtitle} / ${info.subtitleNepali} • Score: ${scores[type]}/${maxScore}</div>
                    </div>
                </div>
                <div class="type-body">
                    <div class="type-desc">
                        <strong>English:</strong> ${info.description}<br><br>
                        <strong>नेपाली:</strong> ${info.descriptionNepali}
                    </div>
                    <div class="type-subsection">
                        <h4>💪 Key Strengths</h4>
                        <div class="strengths-grid">${strengthsHTML}</div>
                    </div>
                    <div class="type-subsection">
                        <h4>💼 Recommended Careers</h4>
                        <div class="careers-wrap">${careersHTML}</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="page-footer">
            <div class="footer-left"><img src="${companyBranding.logoUrl}" alt="Logo" class="footer-logo" onerror="this.style.display='none'"><span>${companyBranding.name} • ${companyBranding.website}</span></div>
            <div>Page ${idx + 3}</div>
        </div>
    </div>`;
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
        .careers-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
        .career-tag { padding: 6px 12px; border-radius: 15px; font-size: 12px; font-weight: 500; }
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
            <div>Page ${topThree.length + 3}</div>
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
