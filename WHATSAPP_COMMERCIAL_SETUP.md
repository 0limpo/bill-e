# WhatsApp Business API - Commercial Activation Guide

**Last Updated:** 2025-11-27
**Current Status:** Sandbox Mode (Only verified numbers)
**Target:** Full Commercial Access (Any number)

---

## Current Configuration

**Backend URL:** https://bill-e-backend-lfwp.onrender.com
**Webhook URL:** https://bill-e-backend-lfwp.onrender.com/webhook/whatsapp
**Webhook Status:** Verified and Working
**Meta App ID:** 1157116873291877

**Environment Variables (Render):**
- WHATSAPP_ACCESS_TOKEN
- WHATSAPP_PHONE_NUMBER_ID
- WHATSAPP_VERIFY_TOKEN

---

## PHASE 1: Webhook Configuration (5-10 minutes)

### Step 1.1: Access Meta Developer Console

1. Go to: https://developers.facebook.com/apps/1157116873291877
2. Login with your Facebook account
3. Navigate to **WhatsApp > Configuration**

### Step 1.2: Configure Webhook

1. In the **Webhook** section, click **Edit**
2. Enter callback URL:
   ```
   https://bill-e-backend-lfwp.onrender.com/webhook/whatsapp
   ```

3. Enter verify token (must match WHATSAPP_VERIFY_TOKEN in Render):
   ```
   bill-e-webhook-verify-2024
   ```

4. Click **Verify and Save**

**Expected Result:** Webhook should verify successfully (green checkmark)

### Step 1.3: Subscribe to Webhook Fields

In the same **Configuration** page, subscribe to these webhook fields:
- messages
- message_deliveries
- message_echoes
- message_reads
- message_status

Click **Subscribe** for each field.

### Step 1.4: Test Webhook

1. Send a test message from Meta Dashboard
2. Check Render logs: https://dashboard.render.com/
3. Look for: "Mensaje recibido" in logs

**Verification Command:**
```bash
curl "https://bill-e-backend-lfwp.onrender.com/webhook/whatsapp?hub.mode=subscribe&hub.challenge=TEST&hub.verify_token=bill-e-webhook-verify-2024"
# Should return: TEST
```

---

## PHASE 2: Business Manager Setup (15-30 minutes)

### Step 2.1: Create/Access Business Manager

1. Go to: https://business.facebook.com/
2. If you don't have one, click **Create Account**
3. Fill in your business information:
   - Business Name: "Bill-e" or your company name
   - Your Name
   - Business Email

### Step 2.2: Add WhatsApp Business Account

1. In Business Manager, go to **Business Settings**
2. Navigate to **Accounts > WhatsApp Business Accounts**
3. Click **Add** > **Add a WhatsApp Business Account**
4. Link your existing app (1157116873291877)

### Step 2.3: Business Verification

**Required for commercial access:**

1. In Business Manager > **Business Settings** > **Security Center**
2. Click **Start Verification**
3. Provide:
   - Business documentation (Tax ID, Business registration)
   - Business address
   - Business phone number
   - Business website (optional but recommended)

**Documents needed (Chile):**
- RUT de la empresa
- Certificado de inicio de actividades (SII)
- Or: Startup certificate if you're a new business

**Processing time:** 1-3 business days

### Step 2.4: Add Payment Method (For Cloud API)

1. Business Settings > **Payments**
2. Add credit card or PayPal
3. Set up billing for WhatsApp Cloud API

**Note:** First 1,000 conversations per month are free.

---

## PHASE 3: Display Name & Profile Setup (10 minutes)

### Step 3.1: Configure Display Name

1. Meta Developer Console > WhatsApp > **Configuration**
2. **Display Name** section
3. Enter your business name: "Bill-e"
4. Click **Manage** > **Add a phone number display name**

**Requirements:**
- Must represent your business
- No generic terms ("Support", "Customer Service")
- Must match your business verification

### Step 3.2: Upload Profile Picture

1. WhatsApp Manager: https://business.facebook.com/wa/manage/home/
2. Click on your phone number
3. **Profile** > Upload logo/profile picture
4. Requirements:
   - Square image (640x640px recommended)
   - Professional logo
   - Clear and recognizable

### Step 3.3: Business Profile

1. **About** section: "Asistente inteligente para dividir cuentas de restaurante"
2. **Business Category**: Select "Financial Services" or "Technology"
3. **Website**: https://bill-e.vercel.app (if available)
4. **Business Hours**: Set or leave as 24/7 (recommended for bot)

---

## PHASE 4: App Review Process (3-7 days)

### Step 4.1: Prepare for App Review

**What Meta reviews:**
- Your business is legitimate
- Your use case complies with WhatsApp policies
- Your bot provides value to users
- You respect user privacy

### Step 4.2: Required Permissions

You need to request these permissions for commercial use:

1. Meta Developer Console > **App Review**
2. Request these permissions:
   - `whatsapp_business_messaging` (Required)
   - `whatsapp_business_management` (Required)

### Step 4.3: Provide Use Case Information

**App Name:** Bill-e
**App Description:**
```
Bill-e is an intelligent WhatsApp bot that helps groups of friends split restaurant bills fairly.

Users send a photo of their restaurant receipt, and Bill-e:
1. Automatically reads the bill using OCR (Google Cloud Vision)
2. Extracts items, prices, subtotal, and tip
3. Generates a shareable link where friends can assign items
4. Calculates how much each person owes (including proportional tip)

This solves the common problem of splitting complex bills when dining out with friends.
```

**Use Case Category:** Utility / Productivity
**Target Audience:** Friends dining out together (18-35 years old)
**Geographic Focus:** Chile (can expand later)

### Step 4.4: Create Demo Video

**Required:** A short video (1-2 minutes) showing:
1. User sends receipt photo via WhatsApp
2. Bot processes and responds with link
3. User opens link in browser
4. Shows bill splitting interface
5. Final calculation

**Tools:**
- Screen recording: OBS Studio, Loom, or phone screen recorder
- Upload to YouTube (unlisted)
- Provide link in App Review

### Step 4.5: Privacy Policy & Terms

**Required documents:**

1. **Privacy Policy** - Must include:
   - What data you collect (phone number, receipt images)
   - How you use it (OCR processing, bill splitting)
   - How long you store it (2 hours via Redis)
   - User rights (delete data on request)
   - Hosted at: https://bill-e.vercel.app/privacy (create this)

2. **Terms of Service:**
   - Service description
   - User responsibilities
   - Limitations of liability
   - Hosted at: https://bill-e.vercel.app/terms (create this)

**Quick templates:**
- Privacy Policy Generator: https://www.privacypolicygenerator.info/
- Terms Generator: https://www.termsofservicegenerator.net/

### Step 4.6: Submit for Review

1. Meta Developer Console > **App Review** > **Permissions and Features**
2. Click **Request** next to `whatsapp_business_messaging`
3. Fill in:
   - Use case description (see above)
   - Demo video URL
   - Privacy Policy URL
   - Terms of Service URL
   - Test account (if needed)
4. Click **Submit**

**Review timeline:** 3-7 business days
**You'll receive:** Email notification when approved/rejected

---

## PHASE 5: Message Templates (Optional but Recommended)

### Why Templates?

For **outbound messages** (you initiating conversation), WhatsApp requires pre-approved templates.

**Note:** Bill-e is primarily reactive (users message first), so templates are optional.

### Step 5.1: Create Message Template

1. WhatsApp Manager > **Message Templates**
2. Click **Create Template**
3. Example template:

**Name:** `bill_processed`
**Category:** Utility
**Language:** Spanish
**Content:**
```
Hola! Tu boleta ha sido procesada exitosamente.

Total: {{1}}
Items: {{2}}

Divide tu cuenta aquí: {{3}}
```

### Step 5.2: Submit for Approval

Templates need Meta approval (24-48 hours)

---

## PHASE 6: Rate Limits & Tier System

### Understanding Tiers

WhatsApp has a tier system based on business verification and quality:

**Tier 1 (Unverified):** 1,000 unique conversations/24h
**Tier 2 (Verified):** 10,000 unique conversations/24h
**Tier 3 (High quality):** 100,000 unique conversations/24h
**Unlimited:** Available after sustained high quality

### Quality Rating

Maintain high quality by:
- Fast response times (< 1 minute with bot)
- Low block rate (< 1%)
- Low report rate (< 0.5%)
- Useful, relevant messages

**Monitor quality:**
WhatsApp Manager > **Insights** > **Quality Rating**

---

## PHASE 7: Final Verification & Testing

### Step 7.1: Verify Commercial Access

Once approved, test with any phone number (not just sandbox):

1. Add any Chilean phone number to WhatsApp
2. Send message to your Bill-e number
3. Should receive automated response

### Step 7.2: Test Complete Flow

1. Send "hola" - Check for welcome message
2. Send receipt photo - Check for OCR processing
3. Verify link generation
4. Test link in browser
5. Complete bill splitting

### Step 7.3: Monitor Analytics

**Meta Analytics:**
- WhatsApp Manager > **Insights**
- Track: Messages sent/received, delivery rates, read rates

**Custom Analytics (Optional):**
```python
# Add to webhook_whatsapp.py
import logging

logger = logging.getLogger("whatsapp_analytics")
logger.info(f"Message received from {phone_number}")
logger.info(f"Image processed, session: {session_id}")
```

---

## PHASE 8: Go Live Checklist

Before announcing to public:

- [ ] Webhook verified and working
- [ ] Business verification approved
- [ ] App review approved for `whatsapp_business_messaging`
- [ ] Display name approved
- [ ] Profile picture uploaded
- [ ] Privacy policy live
- [ ] Terms of service live
- [ ] Tested with 5+ non-sandbox numbers
- [ ] Error handling tested (bad images, invalid messages)
- [ ] Payment method added for Cloud API
- [ ] Monitoring/logging set up
- [ ] Customer support plan (how to handle user questions)

---

## Common Issues & Solutions

### Issue 1: Webhook Verification Fails

**Symptoms:** Red X when verifying webhook
**Solutions:**
1. Check verify token matches exactly (case-sensitive)
2. Verify Render service is running (check /health endpoint)
3. Check Render logs for errors
4. Ensure webhook URL is HTTPS (not HTTP)

**Debug:**
```bash
# Test locally
curl "https://bill-e-backend-lfwp.onrender.com/webhook/whatsapp?hub.mode=subscribe&hub.challenge=12345&hub.verify_token=bill-e-webhook-verify-2024"
```

### Issue 2: Messages Not Received

**Symptoms:** Webhook verified, but POST endpoint not receiving messages
**Solutions:**
1. Check webhook field subscriptions (messages must be checked)
2. Verify Render logs show incoming requests
3. Check access token is valid
4. Ensure phone number is verified in Meta

**Debug:**
```bash
# Check Render logs
# Should see: "📨 Mensaje recibido: ..."
```

### Issue 3: Can't Send Messages to Non-Sandbox Numbers

**Symptoms:** Works in sandbox, fails for other numbers
**Solutions:**
1. App review must be approved first
2. Check business verification status
3. Verify you're in correct tier (Tier 1+)
4. Check quality rating (must be High or Medium)

### Issue 4: Business Verification Rejected

**Symptoms:** Meta rejects business verification
**Solutions:**
1. Ensure documents match registered business name
2. Provide additional documentation
3. Use business email (not personal)
4. Add business website if possible
5. Contact Meta support with appeal

### Issue 5: App Review Rejected

**Common reasons:**
- Privacy policy missing or incomplete
- Use case not clear
- Demo video doesn't show actual product
- Bot sends spam or promotional content

**Solutions:**
1. Read rejection reason carefully
2. Update privacy policy to be more specific
3. Create better demo video
4. Clarify use case in resubmission
5. Ensure bot complies with WhatsApp policies

---

## Cost Breakdown

### WhatsApp Cloud API Pricing (2025)

**Free Tier:**
- First 1,000 conversations/month: FREE

**Paid Tier (after 1,000):**
- User-initiated (user messages first): $0.005 - $0.01 per conversation
- Business-initiated (you message first): $0.02 - $0.08 per conversation

**Conversation Window:**
- Lasts 24 hours from last message
- Multiple messages in 24h = 1 conversation

**Bill-e Estimate:**
- Most conversations user-initiated (user sends receipt)
- Estimated cost: ~$5-20 per 1,000 users after free tier

**Other Costs:**
- Google Cloud Vision: ~$1.50 per 1,000 images
- Render backend: $7-25/month (existing)
- Upstash Redis: Free tier or ~$10/month

---

## Ongoing Maintenance

### Weekly Tasks
- [ ] Check quality rating in WhatsApp Manager
- [ ] Review error logs in Render
- [ ] Monitor conversation volume

### Monthly Tasks
- [ ] Review WhatsApp Cloud API costs
- [ ] Check for Meta policy updates
- [ ] Review user feedback/reports
- [ ] Update message templates if needed

### Quarterly Tasks
- [ ] Review and optimize bot responses
- [ ] Update privacy policy if features change
- [ ] Test with new receipt formats
- [ ] Request tier increase if needed

---

## Next Steps (Priority Order)

1. **TODAY:** Configure webhook in Meta Developer Console
2. **THIS WEEK:** Set up Business Manager + start verification
3. **THIS WEEK:** Create privacy policy + terms pages
4. **NEXT WEEK:** Record demo video
5. **NEXT WEEK:** Submit app review
6. **WAIT 3-7 DAYS:** App review processing
7. **AFTER APPROVAL:** Test with real users
8. **LAUNCH:** Announce publicly

---

## Support Resources

**Meta Documentation:**
- WhatsApp Business Platform: https://developers.facebook.com/docs/whatsapp
- Cloud API Getting Started: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
- Webhook Setup: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks

**Meta Support:**
- Developer Support: https://developers.facebook.com/support
- Business Manager Help: https://www.facebook.com/business/help

**Community:**
- Meta Developer Community: https://developers.facebook.com/community
- WhatsApp Business API Forum: https://stackoverflow.com/questions/tagged/whatsapp-business-api

---

## Quick Reference: Current Variables

**From .env (backend/.env):**
```bash
WHATSAPP_VERIFY_TOKEN=bill-e-webhook-verify-2024
WHATSAPP_ACCESS_TOKEN=EAAQcZAEQyOGU...
WHATSAPP_PHONE_NUMBER_ID=883165031548006
META_APP_ID=1157116873291877
META_APP_SECRET=f8608ddbbd...
```

**Render Environment Variables:**
Make sure these are set in: https://dashboard.render.com/

**Frontend URL:**
```bash
FRONTEND_URL=https://bill-e.vercel.app
```

---

## Status Tracking

| Phase | Status | ETA | Notes |
|-------|--------|-----|-------|
| Webhook Config | ✅ Ready | Complete | Verified working |
| Business Manager | ⏳ Pending | Today | Need to create/link |
| Business Verification | ⏳ Pending | 1-3 days | After Business Manager |
| Privacy Policy | ⏳ Pending | 1-2 days | Need to create page |
| Terms of Service | ⏳ Pending | 1-2 days | Need to create page |
| Demo Video | ⏳ Pending | 2-3 days | Need to record |
| App Review Submit | ⏳ Pending | 3-4 days | After above complete |
| App Review Approval | ⏳ Pending | 3-7 days | Meta processing |
| Commercial Access | ⏳ Pending | ~2 weeks | After all above |

---

**Last Updated:** 2025-11-27
**Document Version:** 1.0
**Maintained by:** Bill-e Team
