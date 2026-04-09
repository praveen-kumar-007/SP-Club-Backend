# Bravo/Brevo Email Setup (API Key Only)

This project uses Bravo/Brevo HTTP API for all mail flows.
No SMTP user/password and no SendGrid is needed.

## Required Environment Variables

Set these variables in your backend deployment (Render/local .env):

```dotenv
BRAVO_API_KEY=your_bravo_api_key
MAIL_SENDER_EMAIL=spkabaddigroupdhanbad@gmail.com
MAIL_SENDER_NAME=SP Kabaddi Group Dhanbad
FRONTEND_URL=https://spkabaddi.me
CLUB_LOGO_URL=https://spkabaddi.me/Logo.png
```

## Notes

- `BRAVO_API_KEY`: single required mail API key.
- `MAIL_SENDER_EMAIL`: from address shown in emails.
- `MAIL_SENDER_NAME`: sender display name.
- `FRONTEND_URL`: used for links (for example forgot-password link in email).
- `CLUB_LOGO_URL`: optional but recommended for branded templates.

## Current Mail Flows Using Bravo/Brevo

- Application processing email (on registration submit)
- Application approval email (with credential + change-password guidance)
- Player forgot-password OTP email
- Admin forgot-password OTP email
- Admin custom broadcast mails (all/selected players)

## Mail Toggle

Admin can enable/disable mail from admin panel Mail Center.
If toggle is OFF, mail requests are skipped.

## Troubleshooting

### Mail not sending

1. Verify `BRAVO_API_KEY` is set and valid.
2. Check backend logs for "Brevo send failed" details.
3. Ensure `MAIL_SENDER_EMAIL` is verified in your Bravo/Brevo account.
4. Ensure deployment has latest environment variables and is redeployed.

### OTP not received

1. Check spam/junk folder.
2. Verify mail toggle is ON in Admin Mail Center.
3. Confirm backend can access `https://api.brevo.com/v3/smtp/email`.
