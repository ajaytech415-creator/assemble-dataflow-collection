import cron from 'node-cron';
import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import { generateWipExcelBuffer } from '../routes/wipReport.js';

// Setup email transporter using standard SMTP
const createTransporter = () => {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  
  if (!user || !pass) {
    console.warn('[Auto-Backup] Missing EMAIL_USER or EMAIL_PASS environment variables.');
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail', // Uses standard Gmail service connection
    auth: {
      user: user,
      pass: pass,
    }
  });
};

const performBackupAndEmail = async () => {
  console.log('[Auto-Backup] Starting automated weekly backup generation...');
  try {
    // 1. Fetch entire Database as Raw JSON
    const collections = await mongoose.connection.db.collections();
    const dbData = {};

    for (let collection of collections) {
      const name = collection.collectionName;
      const docs = await collection.find({}).toArray();
      dbData[name] = docs;
    }

    const jsonBackupBuffer = Buffer.from(JSON.stringify(dbData, null, 2), 'utf-8');

    // 2. Generate the exact WIP Report (All Time) Excel file natively
    // We pass null for dates to get ALL_TIME data just like the dashboard download
    const { buf: excelBuffer, filename: excelFilename } = await generateWipExcelBuffer(null, null);

    // 3. Prepare the Email
    const transporter = createTransporter();
    if (!transporter) {
      console.warn('[Auto-Backup] Backup generated but aborted sending: No email configuration found.');
      return; // Can't send if no credentials
    }

    const mailOptions = {
      from: `"Assembly Dataflow" <${process.env.EMAIL_USER}>`,
      to: 'Ringproduction@ultrahuman.com', // Target email
      subject: `Weekly Automated Database Backup — ${new Date().toLocaleDateString()}`,
      text: 
`Hello!

Please find attached your automated weekly database backups for the Assembly Dataflow Collection project.

Included in this email:
1. WIP_Report.xlsx: The full, up-to-date Work-In-Progress spreadsheet.
2. Raw_Database_Backup.json: A raw developer data export of all users, MOs, configurations, etc.

Do not reply to this automated email.`,
      attachments: [
        {
          filename: excelFilename || 'WIP_Report.xlsx',
          content: excelBuffer
        },
        {
          filename: `Database_Raw_Export_${new Date().toISOString().split('T')[0]}.json`,
          content: jsonBackupBuffer
        }
      ]
    };

    // 4. Send Email
    await transporter.sendMail(mailOptions);
    console.log('[Auto-Backup] Successfully sent automated weekly backup to Ringproduction@ultrahuman.com!');
  } catch (error) {
    console.error('[Auto-Backup] Error generating or sending automated backup:', error);
  }
};

// Initialize the Cron Job
export const initAutoBackup = () => {
  // Cron schedule: "0 0 * * 0" means Every Sunday at 12:00 AM (Midnight)
  // Note: "0 2 * * 0" would mean Sunday 2:00 AM
  const schedule = '0 0 * * 0'; 
  
  // We'll also do a startup check just to verify credentials are set up
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('[Auto-Backup] ⚠️  Warning: Nodemailer is missing EMAIL_USER or EMAIL_PASS. Automated Sunday backups will fail until these are configured on Render.');
  }

  cron.schedule(schedule, () => {
    performBackupAndEmail();
  });
  console.log(`[Auto-Backup] Weekly email backup job scheduled to run at: ${schedule} (UTC)`);
};
