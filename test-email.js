// test-email.js - Quick test to verify email sending works
require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  },
  tls: {
    rejectUnauthorized: false
  }
});

async function testEmail() {
  console.log('📧 Testing email with credentials:');
  console.log('   EMAIL_USER:', process.env.EMAIL_USER);
  console.log('   EMAIL_PASSWORD:', process.env.EMAIL_PASSWORD ? 'SET (hidden)' : 'NOT SET');
  
  try {
    console.log('\n🔄 Verifying transporter...');
    await transporter.verify();
    console.log('✅ Transporter verified successfully!\n');
    
    console.log('📨 Sending test email to impraveen105@gmail.com...');
    const info = await transporter.sendMail({
      from: `"SP Club Test" <${process.env.EMAIL_USER}>`,
      to: 'impraveen105@gmail.com',
      subject: '🎉 Test Email from SP Club Backend',
      html: `
        <div style="font-family: Arial; padding: 20px; background: #f4f4f4;">
          <div style="background: white; padding: 30px; border-radius: 10px; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #0a192f;">✅ Email System Working!</h2>
            <p>This is a test email from SP Club backend.</p>
            <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
            <p style="color: green;">If you received this, the email system is configured correctly! 🎉</p>
            <hr>
            <p style="color: #666; font-size: 12px;">
              Sent from: ${process.env.EMAIL_USER}<br>
              Test email for verification purposes
            </p>
          </div>
        </div>
      `
    });
    
    console.log('\n✅ SUCCESS! Email sent!');
    console.log('   Message ID:', info.messageId);
    console.log('   Response:', info.response);
    console.log('\n📬 Check inbox: impraveen105@gmail.com');
    console.log('   (Also check spam/junk folder if not in inbox)\n');
  } catch (error) {
    console.error('\n❌ ERROR sending email:');
    console.error('   Error type:', error.code || error.name);
    console.error('   Error message:', error.message);
    console.error('   Full error:', error);
    console.error('\n');
  }
}

testEmail();
