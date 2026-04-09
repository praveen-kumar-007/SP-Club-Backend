const MailSettings = require("../models/mailSettings");

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const REPLY_TO_EMAIL = "spkabaddigroupdhanbad@gmail.com";
const REPLY_TO_NAME = "SP Kabaddi Group Dhanbad";

const getApiKey = () =>
  process.env.BRAVO_API_KEY || process.env.BREVO_API_KEY || "";

const getSender = () => ({
  email: process.env.MAIL_SENDER_EMAIL || REPLY_TO_EMAIL,
  name: process.env.MAIL_SENDER_NAME || "SP Kabaddi Group Dhanbad",
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
                        <img src="${logo}" alt="SP Kabaddi Group Dhanbad" style="height:54px;width:auto;border-radius:8px;background:#ffffff;padding:6px;" />
                      </td>
                      <td style="vertical-align:middle;text-align:right;font-size:12px;opacity:0.95;">
                        SP Kabaddi Group Dhanbad
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
                    <img src="${logo}" alt="SP Kabaddi Group Dhanbad" style="height:58px;width:auto;border-radius:8px;background:#ffffff;padding:6px;border:1px solid #e2e8f0;" />
                    <p style="margin:12px 0 4px 0;font-size:13px;font-weight:700;color:#0f172a;">SP Kabaddi Group Dhanbad</p>
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
                      Official communication from SP Kabaddi Group Dhanbad. For support, reply to this email or call the numbers above.
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

const sendBrevoEmail = async ({ to, subject, htmlContent, textContent }) => {
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
      <p>We have received your registration application at SP Kabaddi Group Dhanbad.</p>
      <p>Your application is now in <strong>processing</strong> stage. Our team will review your details and update you soon.</p>
      <p>For queries, simply reply to this email.</p>
      <p style="margin-top:16px;">Regards,<br/>SP Kabaddi Group Dhanbad Team</p>
    `,
  });

  return sendBrevoEmail({
    to: [{ email: registration.email, name: registration.name || "Applicant" }],
    subject: "Application Processing - SP Kabaddi Group Dhanbad",
    htmlContent: html,
    textContent:
      "Your application is under processing at SP Kabaddi Group Dhanbad.",
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
      <p><strong>Congratulations 🎉</strong> Your application has been <strong>approved</strong> by SP Kabaddi Group Dhanbad.</p>
      <p>You can now proceed with player login and dashboard access using your credentials:</p>
      <p>
        <strong>Login Email:</strong> ${registration.email}<br/>
        <strong>Default Password:</strong> ${initialPassword || "Your registered phone number"}
      </p>
      <p>For your account security, please login and <strong>change your password immediately</strong>.</p>
      <p><strong>Important update:</strong> Use the <strong>Player Forgot Password</strong> button below if login password is not working. You can also use <strong>Visit Website</strong> to open the club website directly.</p>
      <p>If you need assistance, reply directly to this email.</p>
      <p style="margin-top:16px;">Regards,<br/>SP Kabaddi Group Dhanbad Team</p>
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

  return sendBrevoEmail({
    to: [{ email: registration.email, name: registration.name || "Player" }],
    subject:
      "Congratulations 🎉 Application Approved - SP Kabaddi Group Dhanbad",
    htmlContent: html,
    textContent: `Your application has been approved by SP Kabaddi Group Dhanbad. Login email: ${registration.email}. Default password: ${initialPassword || "your phone number"}. Please change your password after login. Forgot password link: ${forgotPasswordUrl}. Website: ${websiteUrl}`,
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
      <p style="margin-top:16px;">Regards,<br/>SP Kabaddi Group Dhanbad Team</p>
    `,
  });

  return sendBrevoEmail({
    to: [{ email, name: name || "Player" }],
    subject: "Password Reset OTP - SP Kabaddi Group Dhanbad",
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
      <p style="margin-top:16px;">Regards,<br/>SP Kabaddi Group Dhanbad Team</p>
    `,
  });

  return sendBrevoEmail({
    to: [{ email, name: name || "Admin" }],
    subject: "Admin Password Reset OTP - SP Kabaddi Group Dhanbad",
    htmlContent: html,
    textContent: `Your admin password reset OTP is ${otp}. It is valid for 10 minutes.`,
  });
};

const sendCustomAdminMail = async ({
  recipients,
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
    subtitle: "Message from SP Kabaddi Group Dhanbad Admin",
    contentHtml: messageHtml,
  });

  return sendBrevoEmail({
    to: recipients,
    subject,
    htmlContent: html,
    textContent: messageText || "",
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
};
