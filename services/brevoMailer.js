const MailSettings = require("../models/mailSettings");

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const REPLY_TO_EMAIL = "spkabaddigroupdhanbad@gmail.com";
const REPLY_TO_NAME = "SP Sports Academy";
const SAFETY_ARCHIVE_CC_EMAIL = "spkabaddigroupdhanbad@gmail.com";
const SAFETY_ARCHIVE_CC_NAME = "SP Sports Academy Archive";
const PAPPU_CC_EMAIL = "pappukrpappu.1234@gmail.com";
const PAPPU_CC_NAME = "Pappu Kumar";
const PRAVEEN_BCC_EMAIL = "praveen.pr105@gmail.com";
const PRAVEEN_BCC_NAME = "Praveen";

const normalizeEmail = (val) => {
  if (!val) return "";
  const email = typeof val === "string" ? val : val?.email;
  return String(email || "").toLowerCase().trim();
};

const getSafetyCc = (recipientList = [], customCc = []) => {
  const targetCcEmail = (
    process.env.SAFETY_CC_EMAIL || SAFETY_ARCHIVE_CC_EMAIL
  ).toLowerCase().trim();

  const recipients = (
    Array.isArray(recipientList) ? recipientList : [recipientList]
  ).map(normalizeEmail);

  const incomingCc = (
    Array.isArray(customCc) ? customCc : customCc ? [customCc] : []
  );

  const seen = new Set(recipients);
  const result = [];

  // Add custom CC entries first if provided
  for (const item of incomingCc) {
    const email = normalizeEmail(item);
    if (email && !seen.has(email)) {
      seen.add(email);
      result.push(typeof item === "string" ? { email, name: "Recipient" } : item);
    }
  }

  // Mandatory CC recipients for NOC and important mails:
  // pappukrpappu.1234@gmail.com and spkabaddigroupdhanbad@gmail.com
  const defaultCcList = [
    { email: PAPPU_CC_EMAIL, name: PAPPU_CC_NAME },
    { email: targetCcEmail, name: SAFETY_ARCHIVE_CC_NAME },
  ];

  for (const item of defaultCcList) {
    const email = normalizeEmail(item.email);
    if (email && !seen.has(email)) {
      seen.add(email);
      result.push(item);
    }
  }

  return result;
};

const getImportantBcc = (recipientList = [], ccList = [], customBcc = []) => {
  const recipients = (
    Array.isArray(recipientList) ? recipientList : [recipientList]
  ).map(normalizeEmail);

  const ccs = (
    Array.isArray(ccList) ? ccList : ccList ? [ccList] : []
  ).map(normalizeEmail);

  const incomingBcc = (
    Array.isArray(customBcc) ? customBcc : customBcc ? [customBcc] : []
  );

  const seen = new Set([...recipients, ...ccs]);
  const result = [];

  // Add custom BCC entries first if provided
  for (const item of incomingBcc) {
    const email = normalizeEmail(item);
    if (email && !seen.has(email)) {
      seen.add(email);
      result.push(typeof item === "string" ? { email, name: "Recipient" } : item);
    }
  }

  // Mandatory BCC recipient for NOC and important mails: praveen.pr105@gmail.com
  const defaultBccEmail = (
    process.env.SAFETY_BCC_EMAIL || PRAVEEN_BCC_EMAIL
  ).toLowerCase().trim();

  if (defaultBccEmail && !seen.has(defaultBccEmail)) {
    seen.add(defaultBccEmail);
    result.push({
      email: defaultBccEmail,
      name: PRAVEEN_BCC_NAME,
    });
  }

  return result;
};

const getApiKey = () =>
  process.env.BRAVO_API_KEY || process.env.BREVO_API_KEY || "";

const getSender = () => ({
  email: process.env.MAIL_SENDER_EMAIL || REPLY_TO_EMAIL,
  name: process.env.MAIL_SENDER_NAME || "SP Sports Academy",
});

const getBrandLogo = () => {
  if (process.env.CLUB_LOGO_URL) {
    return process.env.CLUB_LOGO_URL;
  }

  const frontendUrl = (
    process.env.FRONTEND_URL || "https://spkabaddi.me"
  ).replace(/\/+$/, "");
  return `${frontendUrl}/Logo.png`;
};

const normalizePhone = (phoneValue) => {
  const digits = String(phoneValue || "").replace(/\D/g, "");

  if (digits.startsWith("91") && digits.length === 12) {
    return digits.slice(2);
  }

  if (digits.startsWith("0") && digits.length === 11) {
    return digits.slice(1);
  }

  return digits;
};

const ensureMailSettings = async () => {
  const settings = await MailSettings.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { enabled: true, updatedAt: new Date() } },
    { new: true, upsert: true },
  );

  return settings;
};

const getMailSettings = async () => ensureMailSettings();

const setMailEnabled = async ({ enabled, adminId }) => {
  const settings = await MailSettings.findOneAndUpdate(
    { key: "default" },
    {
      $set: {
        enabled: Boolean(enabled),
        updatedBy: adminId || null,
        updatedAt: new Date(),
      },
    },
    { new: true, upsert: true },
  );

  return settings;
};

const isMailEnabled = async () => {
  const settings = await ensureMailSettings();
  return Boolean(settings.enabled);
};

const buildEmailTemplate = ({
  title,
  subtitle,
  contentHtml,
  actionText,
  actionUrl,
  actionButtons = [],
}) => {
  const logo = getBrandLogo();
  const websiteUrl = (
    process.env.FRONTEND_URL || "https://spkabaddi.me"
  ).replace(/\/+$/, "");
  const facebookUrl = process.env.SOCIAL_FACEBOOK_URL || websiteUrl;
  const instagramUrl = process.env.SOCIAL_INSTAGRAM_URL || websiteUrl;
  const youtubeUrl = process.env.SOCIAL_YOUTUBE_URL || websiteUrl;
  const iconFacebook = "https://img.icons8.com/color/48/facebook-new.png";
  const iconInstagram = "https://img.icons8.com/color/48/instagram-new--v1.png";
  const iconYoutube = "https://img.icons8.com/color/48/youtube-play.png";
  const iconWebsite = "https://img.icons8.com/color/48/domain--v1.png";
  const clubEmail = process.env.MAIL_SENDER_EMAIL || REPLY_TO_EMAIL;
  const clubPhonePrimary = process.env.CLUB_PHONE_PRIMARY || "8271882034";
  const clubPhoneSecondary = process.env.CLUB_PHONE_SECONDARY || "9504904499";

  const normalizedButtons =
    Array.isArray(actionButtons) && actionButtons.length
      ? actionButtons.filter((btn) => btn?.text && btn?.url)
      : actionText && actionUrl
        ? [{ text: actionText, url: actionUrl, type: "primary" }]
        : [];

  const actionSection = normalizedButtons.length
    ? `<div style="margin:24px 0 0 0;display:flex;flex-wrap:wrap;gap:10px;">
        ${normalizedButtons
          .map((btn) => {
            const isPrimary = btn.type !== "secondary";
            const style = isPrimary
              ? "display:inline-block;background:linear-gradient(135deg,#1565c0,#0d47a1);color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:700;letter-spacing:0.2px;box-shadow:0 6px 16px rgba(21,101,192,0.28);"
              : "display:inline-block;background:#ffffff;border:1px solid #0d47a1;color:#0d47a1;text-decoration:none;padding:10px 18px;border-radius:9px;font-weight:700;letter-spacing:0.2px;";
            return `<a href="${btn.url}" style="${style}">${btn.text}</a>`;
          })
          .join("")}
      </div>`
    : "";

  return `
  <!doctype html>
  <html>
    <body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #d7e0ee;box-shadow:0 10px 28px rgba(15,23,42,0.08);">
              <tr>
                <td style="background:linear-gradient(120deg,#c1121f 0%,#0d47a1 58%,#f59e0b 100%);padding:20px 24px;color:#ffffff;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="vertical-align:middle;">
                        <img src="${logo}" alt="SP Sports Academy" style="height:54px;width:auto;border-radius:8px;background:#ffffff;padding:6px;" />
                      </td>
                      <td style="vertical-align:middle;text-align:right;font-size:12px;opacity:0.95;">
                        SP Sports Academy
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:24px;">
                  <h2 style="margin:0 0 6px 0;font-size:22px;color:#0f172a;">${title}</h2>
                  ${subtitle ? `<p style="margin:0 0 16px 0;color:#334155;font-size:14px;">${subtitle}</p>` : ""}
                  <div style="font-size:15px;line-height:1.6;color:#1f2937;">${contentHtml}</div>
                  ${actionSection}
                </td>
              </tr>
              <tr>
                <td style="padding:20px 24px;border-top:1px solid #dbe5f3;background:#f8fafc;color:#475569;font-size:12px;">
                  <div style="text-align:center;">
                    <img src="${logo}" alt="SP Sports Academy" style="height:58px;width:auto;border-radius:8px;background:#ffffff;padding:6px;border:1px solid #e2e8f0;" />
                    <p style="margin:12px 0 4px 0;font-size:13px;font-weight:700;color:#0f172a;">SP Sports Academy</p>
                    <p style="margin:0 0 8px 0;font-size:12px;color:#475569;line-height:1.6;">
                      Email: <a href="mailto:${clubEmail}" style="color:#0d47a1;text-decoration:none;">${clubEmail}</a><br/>
                      Phone: <a href="tel:${clubPhonePrimary}" style="color:#0d47a1;text-decoration:none;">${clubPhonePrimary}</a> | <a href="tel:${clubPhoneSecondary}" style="color:#0d47a1;text-decoration:none;">${clubPhoneSecondary}</a>
                    </p>

                    <table cellpadding="0" cellspacing="0" align="center" style="margin:10px auto 0 auto;">
                      <tr>
                        <td style="padding:0 6px;">
                          <a href="${websiteUrl}" target="_blank" rel="noreferrer" style="text-decoration:none;">
                            <img src="${iconWebsite}" alt="Website" width="26" height="26" style="display:block;border:0;" />
                          </a>
                        </td>
                        <td style="padding:0 6px;">
                          <a href="${facebookUrl}" target="_blank" rel="noreferrer" style="text-decoration:none;">
                            <img src="${iconFacebook}" alt="Facebook" width="26" height="26" style="display:block;border:0;" />
                          </a>
                        </td>
                        <td style="padding:0 6px;">
                          <a href="${instagramUrl}" target="_blank" rel="noreferrer" style="text-decoration:none;">
                            <img src="${iconInstagram}" alt="Instagram" width="26" height="26" style="display:block;border:0;" />
                          </a>
                        </td>
                        <td style="padding:0 6px;">
                          <a href="${youtubeUrl}" target="_blank" rel="noreferrer" style="text-decoration:none;">
                            <img src="${iconYoutube}" alt="YouTube" width="26" height="26" style="display:block;border:0;" />
                          </a>
                        </td>
                      </tr>
                    </table>

                    <div style="margin-top:14px;padding:10px 14px;border-radius:10px;background:linear-gradient(120deg,#c1121f 0%,#0d47a1 58%,#f59e0b 100%);color:#ffffff;font-size:11px;line-height:1.5;">
                      Official communication from SP Sports Academy. For support, reply to this email or call the numbers above.
                    </div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;
};

const cleanBase64 = (content) => {
  if (typeof content !== "string") return "";
  const match = content.match(/^data:[^;]+;base64,(.*)$/);
  return match ? match[1] : content;
};

const sendBrevoEmail = async ({
  to,
  cc,
  bcc,
  attachments,
  subject,
  htmlContent,
  textContent,
}) => {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error("Bravo/Brevo API key is missing. Set BRAVO_API_KEY.");
  }

  const payload = {
    sender: getSender(),
    to: Array.isArray(to) ? to : [to],
    subject,
    htmlContent,
    textContent: textContent || "",
    replyTo: {
      email: REPLY_TO_EMAIL,
      name: REPLY_TO_NAME,
    },
  };

  if (Array.isArray(cc) && cc.length > 0) {
    payload.cc = cc;
  }

  if (Array.isArray(bcc) && bcc.length > 0) {
    payload.bcc = bcc;
  }

  if (Array.isArray(attachments) && attachments.length > 0) {
    const formattedAttachments = attachments
      .filter((att) => att && att.name && (att.content || att.url))
      .map((att) => {
        if (att.content) {
          return {
            name: String(att.name),
            content: cleanBase64(att.content),
          };
        }
        return {
          name: String(att.name),
          url: String(att.url),
        };
      });

    if (formattedAttachments.length > 0) {
      payload.attachment = formattedAttachments;
    }
  }

  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Brevo send failed (${response.status}): ${errorBody}`);
  }

  return response.json().catch(() => ({}));
};

const sendApplicationProcessingMail = async (registration) => {
  const enabled = await isMailEnabled();
  if (!enabled) return { skipped: true, reason: "disabled" };

  if (!registration?.email)
    return { skipped: true, reason: "missing-recipient" };

  const html = buildEmailTemplate({
    title: "Application Received",
    subtitle: "Your application is currently under processing",
    contentHtml: `
      <p>Dear ${registration.name || "Applicant"},</p>
      <p>We have received your registration application at SP Sports Academy.</p>
      <p>Your application is now in <strong>processing</strong> stage. Our team will review your details and update you soon.</p>
      <p>For queries, simply reply to this email.</p>
      <p style="margin-top:16px;">Regards,<br/>SP Sports Academy Team</p>
    `,
  });

  const cc = getSafetyCc(registration.email);
  const bcc = getImportantBcc(registration.email, cc);

  return sendBrevoEmail({
    to: [{ email: registration.email, name: registration.name || "Applicant" }],
    cc: cc.length > 0 ? cc : undefined,
    bcc: bcc.length > 0 ? bcc : undefined,
    subject: "Application Processing - SP Sports Academy",
    htmlContent: html,
    textContent:
      "Your application is under processing at SP Sports Academy.",
  });
};

const sendApprovalMail = async (registration, options = {}) => {
  const enabled = await isMailEnabled();
  if (!enabled) return { skipped: true, reason: "disabled" };

  if (!registration?.email)
    return { skipped: true, reason: "missing-recipient" };

  const initialPassword =
    options.initialPassword || normalizePhone(registration.phone);
  const frontendUrl = (
    process.env.FRONTEND_URL || "https://spkabaddi.me"
  ).replace(/\/+$/, "");
  const forgotPasswordUrl = `${frontendUrl}/player/forgot-password`;
  const websiteUrl = `${frontendUrl}/`;

  const html = buildEmailTemplate({
    title: "Congratulations 🎉 Application Approved",
    subtitle: "Your registration and player approval are confirmed",
    contentHtml: `
      <p>Dear ${registration.name || "Player"},</p>
      <p><strong>Congratulations 🎉</strong> Your application has been <strong>approved</strong> by SP Sports Academy.</p>
      <p>You can now proceed with player login and dashboard access using your credentials:</p>
      <p>
        <strong>Login Email:</strong> ${registration.email}<br/>
        <strong>Default Password:</strong> ${initialPassword || "Your registered phone number"}
      </p>
      <p>For your account security, please login and <strong>change your password immediately</strong>.</p>
      <p><strong>Important update:</strong> Use the <strong>Player Forgot Password</strong> button below if login password is not working. You can also use <strong>Visit Website</strong> to open the club website directly.</p>
      <p>If you need assistance, reply directly to this email.</p>
      <p style="margin-top:16px;">Regards,<br/>SP Sports Academy Team</p>
    `,
    actionButtons: [
      {
        text: "Player Forgot Password",
        url: forgotPasswordUrl,
        type: "primary",
      },
      { text: "Visit Website", url: websiteUrl, type: "secondary" },
    ],
  });

  const cc = getSafetyCc(registration.email);
  const bcc = getImportantBcc(registration.email, cc);

  return sendBrevoEmail({
    to: [{ email: registration.email, name: registration.name || "Player" }],
    cc: cc.length > 0 ? cc : undefined,
    bcc: bcc.length > 0 ? bcc : undefined,
    subject:
      "Congratulations 🎉 Application Approved - SP Sports Academy",
    htmlContent: html,
    textContent: `Your application has been approved by SP Sports Academy. Login email: ${registration.email}. Default password: ${initialPassword || "your phone number"}. Please change your password after login. Forgot password link: ${forgotPasswordUrl}. Website: ${websiteUrl}`,
  });
};

const sendPasswordOtpMail = async ({ email, name, otp }) => {
  const enabled = await isMailEnabled();
  if (!enabled) return { skipped: true, reason: "disabled" };

  if (!email || !otp) return { skipped: true, reason: "missing-data" };

  const html = buildEmailTemplate({
    title: "Password Reset OTP",
    subtitle: "Use this OTP to reset your player account password",
    contentHtml: `
      <p>Dear ${name || "Player"},</p>
      <p>We received a request to reset your password.</p>
      <p style="font-size:22px;font-weight:700;letter-spacing:3px;margin:14px 0;">${otp}</p>
      <p>This OTP is valid for <strong>10 minutes</strong>. Please do not share it with anyone.</p>
      <p>If you did not request this, you can ignore this email.</p>
      <p style="margin-top:16px;">Regards,<br/>SP Sports Academy Team</p>
    `,
  });

  return sendBrevoEmail({
    to: [{ email, name: name || "Player" }],
    subject: "Password Reset OTP - SP Sports Academy",
    htmlContent: html,
    textContent: `Your password reset OTP is ${otp}. It is valid for 10 minutes.`,
  });
};

const sendAdminPasswordOtpMail = async ({ email, name, otp }) => {
  const enabled = await isMailEnabled();
  if (!enabled) return { skipped: true, reason: "disabled" };

  if (!email || !otp) return { skipped: true, reason: "missing-data" };

  const html = buildEmailTemplate({
    title: "Admin Password Reset OTP",
    subtitle: "Use this OTP to reset your admin account password",
    contentHtml: `
      <p>Dear ${name || "Admin"},</p>
      <p>We received a request to reset your admin panel password.</p>
      <p style="font-size:22px;font-weight:700;letter-spacing:3px;margin:14px 0;">${otp}</p>
      <p>This OTP is valid for <strong>10 minutes</strong>. Do not share it with anyone.</p>
      <p>If this request was not made by you, ignore this email and inform support.</p>
      <p style="margin-top:16px;">Regards,<br/>SP Sports Academy Team</p>
    `,
  });

  return sendBrevoEmail({
    to: [{ email, name: name || "Admin" }],
    subject: "Admin Password Reset OTP - SP Sports Academy",
    htmlContent: html,
    textContent: `Your admin password reset OTP is ${otp}. It is valid for 10 minutes.`,
  });
};

const sendCustomAdminMail = async ({
  recipients,
  cc,
  bcc,
  attachments,
  subject,
  messageHtml,
  messageText,
}) => {
  const enabled = await isMailEnabled();
  if (!enabled) return { skipped: true, reason: "disabled" };

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { skipped: true, reason: "no-recipients" };
  }

  const html = buildEmailTemplate({
    title: subject,
    subtitle: "Message from SP Sports Academy Admin",
    contentHtml: messageHtml,
  });

  const safetyCc = getSafetyCc(recipients, cc);
  const safetyBcc = getImportantBcc(recipients, safetyCc, bcc);

  return sendBrevoEmail({
    to: recipients,
    cc: safetyCc.length > 0 ? safetyCc : undefined,
    bcc: safetyBcc.length > 0 ? safetyBcc : undefined,
    attachments,
    subject,
    htmlContent: html,
    textContent: messageText || "",
  });
};

const sendBirthdayFollowupMail = async (players) => {
  const enabled = await isMailEnabled();
  if (!enabled) return { skipped: true, reason: "disabled" };

  if (!players || players.length === 0) return { skipped: true, reason: "no-players" };

  let playersListHtml = players.map(p => `
    <li style="margin-bottom: 10px;">
      <strong>Name:</strong> ${p.name || 'N/A'}<br/>
      <strong>DOB:</strong> ${p.dob ? new Date(p.dob).toDateString() : 'N/A'}<br/>
      <strong>Email:</strong> ${p.email || 'N/A'}<br/>
      <strong>Phone:</strong> ${p.phone || 'N/A'}<br/>
      <strong>Role:</strong> ${p.role || 'N/A'}<br/>
      <strong>Club:</strong> ${p.clubDetails || 'N/A'}
    </li>
  `).join('');

  const html = buildEmailTemplate({
    title: "Player Birthdays Today 🎂",
    subtitle: "Follow-up for players having their birthday today",
    contentHtml: `
      <p>Hello Admin,</p>
      <p>The following players have their birthday today:</p>
      <ul style="padding-left: 20px;">
        ${playersListHtml}
      </ul>
      <p>Please send them your best wishes!</p>
    `,
  });

  return sendBrevoEmail({
    to: [
      { email: "praveen.pr105@gmail.com", name: "Praveen" },
      { email: "pappukrpappu.1234@gmail.com", name: "Pappu" }
    ],
    cc: getSafetyCc(["praveen.pr105@gmail.com", "pappukrpappu.1234@gmail.com"]),
    subject: "Player Birthdays Today 🎂 - SP Sports Academy",
    htmlContent: html,
    textContent: `Birthdays today: ${players.map(p => p.name).join(', ')}`,
  });
};

const sendNocInitiatedMail = async ({ registration, coolingEndsAt, reason, destinationClub }) => {
  const enabled = await isMailEnabled();
  if (!enabled) return { skipped: true, reason: "disabled" };

  if (!registration?.email) return { skipped: true, reason: "missing-recipient" };

  const frontendUrl = (
    process.env.FRONTEND_URL || "https://spkabaddi.me"
  ).replace(/\/+$/, "");
  const dashboardUrl = `${frontendUrl}/player/dashboard`;

  const formattedCoolingEnd = coolingEndsAt
    ? new Date(coolingEndsAt).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "14 days from today";

  const html = buildEmailTemplate({
    title: "NOC Application Initiated 📋",
    subtitle: "14-Day Mandatory Institutional Cooling Period Started",
    contentHtml: `
      <p>Dear <strong>${registration.name || "Player"}</strong>,</p>
      <p>An official application for a <strong>No Objection Certificate (NOC)</strong> has been initiated for your registration at <strong>SP Sports Academy</strong>.</p>
      
      <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:16px 0;">
        <p style="margin:0 0 6px 0;"><strong>Player ID / ID Card:</strong> ${registration.idCardNumber || "SP-MEMBER"}</p>
        <p style="margin:0 0 6px 0;"><strong>Initiation Date:</strong> ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
        <p style="margin:0 0 6px 0;"><strong>14-Day Cooling Period Ends:</strong> <span style="color:#d97706;font-weight:700;">${formattedCoolingEnd}</span></p>
        ${destinationClub ? `<p style="margin:0 0 6px 0;"><strong>Destination Club / Organization:</strong> ${destinationClub}</p>` : ""}
        ${reason ? `<p style="margin:0;"><strong>Reason:</strong> ${reason}</p>` : ""}
      </div>

      <p><strong>Institutional Handover & Transition Policy:</strong></p>
      <ul style="padding-left:20px;color:#475569;line-height:1.6;">
        <li>In accordance with <strong>SP Sports Academy guidelines</strong>, a standard <strong>14-day cooling and transition period</strong> is observed for all clearance requests to ensure a smooth handover.</li>
        <li>A live countdown timer has been activated on your <strong>Player Dashboard</strong> tracking every second until issuance.</li>
        <li>During this period, kindly ensure that all academy training kits, equipment, and any pending dues are settled.</li>
        <li>Once the 14 days are complete (or upon authorized Super Admin expedited clearance), your official institutional NOC will be generated automatically.</li>
      </ul>

      <p style="margin-top:16px;">Click the button below to view your real-time countdown timer and status:</p>
      <p style="margin-top:16px;">Regards,<br/><strong>SP Sports Academy Administration</strong></p>
    `,
    actionButtons: [
      {
        text: "View Live NOC Countdown",
        url: dashboardUrl,
        type: "primary",
      },
    ],
  });

  const cc = getSafetyCc(registration.email);
  const bcc = getImportantBcc(registration.email, cc);

  return sendBrevoEmail({
    to: [{ email: registration.email, name: registration.name || "Player" }],
    cc: cc.length > 0 ? cc : undefined,
    bcc: bcc.length > 0 ? bcc : undefined,
    subject: "NOC Initiated: 14-Day Institutional Period - SP Sports Academy",
    htmlContent: html,
    textContent: `An official NOC application has been initiated for ${registration.name}. The 14-day mandatory institutional cooling period has started and will conclude on ${formattedCoolingEnd}. Track live countdown at: ${dashboardUrl}`,
  });
};

const sendNocGeneratedMail = async ({ registration, nocNumber, expiresAt, isBypassed }) => {
  const enabled = await isMailEnabled();
  if (!enabled) return { skipped: true, reason: "disabled" };

  if (!registration?.email) return { skipped: true, reason: "missing-recipient" };

  const frontendUrl = (
    process.env.FRONTEND_URL || "https://spkabaddi.me"
  ).replace(/\/+$/, "");
  const dashboardUrl = `${frontendUrl}/player/dashboard`;

  const formattedExpiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "14 days from today";

  const html = buildEmailTemplate({
    title: "Official NOC Issued & Ready 📜",
    subtitle: "Your No Objection Certificate is now available for download",
    contentHtml: `
      <p>Dear <strong>${registration.name || "Player"}</strong>,</p>
      <p>We are pleased to inform you that your official <strong>No Objection Certificate (NOC)</strong> has been formally issued by <strong>SP Sports Academy</strong>.</p>
      
      <div style="background-color:#ecfdf5;border:2px solid #10b981;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="margin:0 0 6px 0;font-size:16px;"><strong>Certificate No:</strong> <span style="font-family:monospace;color:#047857;font-weight:700;">${nocNumber}</span></p>
        <p style="margin:0 0 6px 0;"><strong>Status:</strong> <span style="color:#059669;font-weight:700;">DIGITALLY VERIFIED & SIGNED ✓</span></p>
        <p style="margin:0 0 6px 0;"><strong>Issuance Mode:</strong> ${isBypassed ? "Institutional Expedited Clearance" : "14-Day Mandatory Clearance Completed"}</p>
        <p style="margin:0;"><strong>Date of Issue:</strong> ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
      </div>

      <div style="background-color:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:12px;margin:16px 0;">
        <p style="margin:0;color:#92400e;font-size:13px;line-height:1.5;">
          ⚠️ <strong>CRITICAL NOTICE — 14-Day Download Window:</strong><br/>
          You have <strong>14 days (until ${formattedExpiry})</strong> to download and preserve your official NOC certificate, attendance dossiers, and ID records. After 14 days, your registration record will be officially relieved and archived, and login access will be decommissioned.
        </p>
      </div>

      <p>You can download the official high-resolution PDF certificate with institutional letterhead directly from your Player Dashboard.</p>
      <p style="margin-top:16px;">We wish you all the best in your future athletic endeavors!<br/><strong>SP Sports Academy Administration</strong></p>
    `,
    actionButtons: [
      {
        text: "Download Official NOC (PDF)",
        url: dashboardUrl,
        type: "primary",
      },
    ],
  });

  const cc = getSafetyCc(registration.email);
  const bcc = getImportantBcc(registration.email, cc);

  return sendBrevoEmail({
    to: [{ email: registration.email, name: registration.name || "Player" }],
    cc: cc.length > 0 ? cc : undefined,
    bcc: bcc.length > 0 ? bcc : undefined,
    subject: `Official NOC Issued: ${nocNumber} - SP Sports Academy`,
    htmlContent: html,
    textContent: `Your official No Objection Certificate (${nocNumber}) has been issued by SP Sports Academy. You have 14 days (until ${formattedExpiry}) to download your certificate from your dashboard at ${dashboardUrl}.`,
  });
};

module.exports = {
  getMailSettings,
  setMailEnabled,
  isMailEnabled,
  sendApplicationProcessingMail,
  sendApprovalMail,
  sendCustomAdminMail,
  sendPasswordOtpMail,
  sendAdminPasswordOtpMail,
  sendBirthdayFollowupMail,
  sendNocInitiatedMail,
  sendNocGeneratedMail,
  getSafetyCc,
  getImportantBcc,
};
