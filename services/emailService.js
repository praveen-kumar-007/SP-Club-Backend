// services/emailService.js
const nodemailer = require('nodemailer');

// Create transporter using Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Send registration approval email
const sendApprovalEmail = async (registration) => {
  try {
    const mailOptions = {
      from: `"SP Club" <${process.env.EMAIL_USER}>`,
      to: registration.email,
      subject: '🎉 Your SP Club Registration is Approved!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #0a192f 0%, #1e3a5f 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .header h1 { margin: 0; font-size: 28px; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .badge { background: #facc15; color: #0a192f; padding: 8px 16px; border-radius: 20px; display: inline-block; font-weight: bold; margin: 10px 0; }
            .info-box { background: white; padding: 20px; margin: 20px 0; border-left: 4px solid #facc15; border-radius: 5px; }
            .info-row { margin: 10px 0; }
            .label { font-weight: bold; color: #0a192f; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 2px solid #facc15; color: #666; }
            .button { display: inline-block; background: #facc15; color: #0a192f; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Congratulations!</h1>
              <p style="margin: 10px 0; font-size: 16px;">Your Registration is Approved</p>
            </div>
            <div class="content">
              <p>Dear <strong>${registration.name}</strong>,</p>
              
              <p>We are thrilled to inform you that your registration with <strong>SP Club (SP Kabaddi Group Dhanbad)</strong> has been <span class="badge">APPROVED</span>!</p>
              
              <div class="info-box">
                <h3 style="margin-top: 0; color: #0a192f;">📋 Your Registration Details:</h3>
                <div class="info-row">
                  <span class="label">Name:</span> ${registration.name}
                </div>
                <div class="info-row">
                  <span class="label">Father's Name:</span> ${registration.fathersName}
                </div>
                <div class="info-row">
                  <span class="label">Email:</span> ${registration.email}
                </div>
                <div class="info-row">
                  <span class="label">Phone:</span> ${registration.phone}
                </div>
                <div class="info-row">
                  <span class="label">Role:</span> ${registration.role}
                </div>
                <div class="info-row">
                  <span class="label">Blood Group:</span> ${registration.bloodGroup}
                </div>
                <div class="info-row">
                  <span class="label">Registration Date:</span> ${new Date(registration.registeredAt).toLocaleDateString('en-IN', { 
                    day: 'numeric', 
                    month: 'long', 
                    year: 'numeric' 
                  })}
                </div>
              </div>

              <h3 style="color: #0a192f;">🚀 Next Steps:</h3>
              <ul style="line-height: 2;">
                <li>Visit our club at your earliest convenience</li>
                <li>Bring a valid ID proof for verification</li>
                <li>Complete the membership formalities</li>
                <li>Get your official SP Club membership card</li>
              </ul>

              <p style="margin-top: 30px;">
                <strong>Welcome to the SP Club family!</strong> We look forward to seeing you excel in your sporting journey with us.
              </p>

              <div class="footer">
                <p style="margin: 5px 0;"><strong>SP Club (SP Kabaddi Group Dhanbad)</strong></p>
                <p style="margin: 5px 0;">Shakti Mandir Path, Dhanbad, Jharkhand 826007</p>
                <p style="margin: 5px 0;">📞 Phone: +91 9504904499 | +91 9876543210</p>
                <p style="margin: 5px 0;">📧 Email: ${process.env.EMAIL_USER}</p>
                <p style="margin: 5px 0;">🌐 Website: <a href="https://spkabaddi.me" style="color: #facc15;">spkabaddi.me</a></p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Approval email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending approval email:', error);
    return { success: false, error: error.message };
  }
};

// Send registration rejection email
const sendRejectionEmail = async (registration, reason = '') => {
  try {
    const mailOptions = {
      from: `"SP Club" <${process.env.EMAIL_USER}>`,
      to: registration.email,
      subject: 'SP Club Registration Update',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #dc2626; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .header h1 { margin: 0; font-size: 28px; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .info-box { background: white; padding: 20px; margin: 20px 0; border-left: 4px solid #dc2626; border-radius: 5px; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 2px solid #dc2626; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Registration Status Update</h1>
            </div>
            <div class="content">
              <p>Dear <strong>${registration.name}</strong>,</p>
              
              <p>Thank you for your interest in joining <strong>SP Club (SP Kabaddi Group Dhanbad)</strong>.</p>
              
              <div class="info-box">
                <p>After careful review, we regret to inform you that we are unable to approve your registration at this time.</p>
                ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
              </div>

              <p>You are welcome to reapply in the future. If you have any questions, please feel free to contact us.</p>

              <div class="footer">
                <p style="margin: 5px 0;"><strong>SP Club (SP Kabaddi Group Dhanbad)</strong></p>
                <p style="margin: 5px 0;">📞 Phone: +91 9504904499 | +91 9876543210</p>
                <p style="margin: 5px 0;">📧 Email: ${process.env.EMAIL_USER}</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Rejection email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending rejection email:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendApprovalEmail,
  sendRejectionEmail
};
