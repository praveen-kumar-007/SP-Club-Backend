# Email Configuration for Render Deployment

## Required Environment Variables on Render

Make sure these environment variables are set in your Render dashboard:

```
EMAIL_USER=spkabaddigroupdhanbad@gmail.com
EMAIL_PASSWORD=sjildoazowqbvlpd
ADMIN_NOTIFICATION_EMAIL=spkabaddigroupdhanbad@gmail.com
```

## How to Add Environment Variables on Render

1. Go to your Render dashboard: https://dashboard.render.com
2. Select your backend service (SP-Club-Backend)
3. Go to "Environment" tab
4. Click "Add Environment Variable"
5. Add each variable:
   - Key: `EMAIL_USER`
   - Value: `spkabaddigroupdhanbad@gmail.com`
6. Repeat for `EMAIL_PASSWORD` and `ADMIN_NOTIFICATION_EMAIL`
7. Click "Save Changes"
8. Render will automatically redeploy your service

## Testing Email Configuration

After deployment, test if email is configured correctly:

```
GET https://your-backend-url.onrender.com/api/test-email
```

This should return:
```json
{
  "emailConfigured": true,
  "emailUser": "Configured",
  "emailPassword": "Configured",
  "nodeEnv": "production"
}
```

## Checking Logs on Render

1. Go to your service in Render dashboard
2. Click on "Logs" tab
3. Look for these messages:
   - `✅ Email server is ready to send messages` - Email is configured correctly
   - `❌ Email transporter verification failed` - Email configuration issue
   - `📧 Attempting to send approval email to:` - Email sending initiated
   - `✅ SUCCESS: Approval email sent to` - Email sent successfully
   - `❌ FAILED: Could not send approval email` - Email sending failed

## Common Issues

### Issue 1: "Invalid login" or "Username and Password not accepted"
**Solution**: Make sure you're using a Gmail App Password, not your regular Gmail password.

To create Gmail App Password:
1. Go to Google Account: https://myaccount.google.com/security
2. Enable 2-Step Verification (if not already enabled)
3. Go to "App passwords"
4. Generate a new app password for "Mail"
5. Use this password in `EMAIL_PASSWORD`

### Issue 2: Environment variables not loading
**Solution**: 
- Verify variables are saved in Render dashboard
- Check for typos in variable names
- Trigger a manual redeploy after adding variables

### Issue 3: Emails going to spam
**Solution**:
- Ask users to check spam/junk folder
- Add your domain to Gmail's approved senders
- Consider using a professional email service like SendGrid or AWS SES for production

## Production Recommendations

For production use, consider:
1. **SendGrid**: Free tier includes 100 emails/day
2. **AWS SES**: Pay-as-you-go pricing
3. **Mailgun**: Free tier includes 5,000 emails/month

These services have better deliverability than Gmail SMTP.
