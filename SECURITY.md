# 🔐 SECURITY - Bill-e Security Documentation

**Last Updated:** 2025-11-27
**Status:** ✅ Audit Completed - Credentials Rotated

---

## 📋 Security Audit Log

### 2025-11-27: Critical Security Audit & Credential Rotation

**Issue Identified:**
- Google Cloud Vision API credentials exposed in Git repository (unreachable objects)
- Private key, service account email, and project ID compromised
- Repository is **PUBLIC** on GitHub

**Actions Taken:**
1. ✅ Identified exposed credentials using `git fsck --unreachable`
2. ✅ Cleaned local repository with `git reflog expire` + `git gc --prune=now --aggressive`
3. ✅ Rotated Google Cloud Vision API service account credentials
4. ✅ Updated environment variables in Render with new credentials
5. ✅ Force pushed to GitHub to clean remote history
6. ✅ Updated `.env` configuration to use `GOOGLE_APPLICATION_CREDENTIALS_JSON`
7. ✅ Verified all services functioning correctly

**Exposed Credentials (ROTATED):**
- Service Account: `bill-e-vision@bill-e-ocr.iam.gserviceaccount.com` ❌ **DEACTIVATED**
- Private Key ID: `bce903295fd1314e31555a465f18d492cf8a9e48` ❌ **REVOKED**
- New credentials: ✅ **ACTIVE** (stored securely in Render environment variables)

---

## 🔑 Credential Inventory

### Production Credentials (Render Environment Variables)

| Service | Variable Name | Location | Status |
|---------|---------------|----------|--------|
| **Google Cloud Vision** | `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Render Secrets | ✅ Active (Rotated 2025-11-27) |
| **Redis (Upstash)** | `REDIS_URL` | Render Secrets | ✅ Active (Not exposed) |
| **WhatsApp (Meta)** | `WHATSAPP_ACCESS_TOKEN` | Render Secrets | ✅ Active (Not exposed) |
| **WhatsApp** | `WHATSAPP_PHONE_NUMBER_ID` | Render Secrets | ✅ Active |
| **WhatsApp** | `WHATSAPP_VERIFY_TOKEN` | Render Secrets | ✅ Active |
| **Meta App** | `META_APP_ID` | Render Secrets | ✅ Active |
| **Meta App** | `META_APP_SECRET` | Render Secrets | ✅ Active (Not exposed) |

### Local Development (`.env` - NOT COMMITTED)

- File: `backend/.env`
- Git Status: ✅ Protected by `.gitignore`
- Contains: Development credentials (same as production for now)

---

## 🛡️ Security Best Practices

### 1. Credential Management

**DO:**
- ✅ Store all credentials in environment variables
- ✅ Use Render's Secret Files or Environment Variables for production
- ✅ Keep `.env` file in `.gitignore` (already configured)
- ✅ Use `GOOGLE_APPLICATION_CREDENTIALS_JSON` with full JSON content
- ✅ Rotate credentials immediately if exposure is suspected

**DON'T:**
- ❌ NEVER commit `.env` files
- ❌ NEVER commit `*.json` credential files
- ❌ NEVER hardcode API keys in source code
- ❌ NEVER share credentials via Slack, email, or chat

### 2. Git Repository Security

**Current `.gitignore` Protection:**
```gitignore
# Environment variables
.env
.env.local
.env.production

# Google Cloud credentials
*.json
credentials/
keys/
secrets/
backend/*.json
backend/bill-e-ocr-*.json
```

**Regular Checks:**
```bash
# Check for accidentally committed secrets
git log --all -p -S "private_key" -S "client_secret"

# Verify .gitignore is working
git status --ignored

# Clean unreachable objects monthly
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### 3. Google Cloud Vision API

**Service Account Management:**
1. One service account per environment (dev, staging, prod)
2. Principle of least privilege - only `roles/vision.imageAnnotator`
3. Key rotation schedule: Every 90 days
4. Monitor usage in Google Cloud Console

**Environment Variable Setup (Render):**
```bash
# Name: GOOGLE_APPLICATION_CREDENTIALS_JSON
# Type: Secret
# Value: {entire JSON content from service account key}
```

**Local Development:**
```bash
# Option 1: Use GOOGLE_APPLICATION_CREDENTIALS_JSON in .env
GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}'

# Option 2: Use local file (download key, never commit)
GOOGLE_APPLICATION_CREDENTIALS=./bill-e-ocr-credentials.json
```

---

## 🔄 Credential Rotation Process

### Google Cloud Vision API (Every 90 days or immediately if compromised)

1. **Create new service account key:**
   ```bash
   # Via Console: https://console.cloud.google.com/iam-admin/serviceaccounts
   # Or via CLI:
   gcloud iam service-accounts keys create new-key.json \
     --iam-account=bill-e-vision@bill-e-ocr.iam.gserviceaccount.com
   ```

2. **Update Render environment variable:**
   - Go to: https://dashboard.render.com/
   - Service: `bill-e-backend`
   - Environment → Edit `GOOGLE_APPLICATION_CREDENTIALS_JSON`
   - Paste new JSON content
   - Trigger manual deploy

3. **Test new credentials:**
   ```bash
   curl https://bill-e-backend-lfwp.onrender.com/health
   # Upload test image via WhatsApp or web interface
   ```

4. **Revoke old key:**
   ```bash
   gcloud iam service-accounts keys delete OLD_KEY_ID \
     --iam-account=bill-e-vision@bill-e-ocr.iam.gserviceaccount.com
   ```

5. **Verify old key is disabled:**
   - Check Google Cloud Console
   - Monitor for failed API calls

### Redis (Upstash) - If compromised

1. Go to: https://console.upstash.com/
2. Database: `happy-sunfish-40427`
3. Settings → Reset Password
4. Update `REDIS_URL` in Render
5. Redeploy service

### WhatsApp / Meta - If compromised

1. Go to: https://developers.facebook.com/apps/1157116873291877
2. Settings → Basic → Reset App Secret
3. WhatsApp → Configuration → Regenerate Token
4. Update environment variables in Render
5. Update webhook verification token if needed

---

## 📊 Monitoring & Alerts

### Google Cloud Vision API

**Cost Monitoring:**
- Dashboard: https://console.cloud.google.com/billing/
- Budget alert: $10 USD/day
- Email notifications: ON

**Usage Monitoring:**
```bash
# Check recent API calls
gcloud logging read "resource.type=cloud_function" --limit 50
```

**Signs of Compromise:**
- Sudden spike in API requests
- Requests from unusual geographic locations
- Increased costs without corresponding user activity
- API errors related to quota or permissions

### Upstash Redis

**Monitor at:** https://console.upstash.com/
- Connection count
- Memory usage (alert at 80%)
- Command/sec rate

### Render Backend

**Monitor at:** https://dashboard.render.com/
- Response time trends
- Error rate (alert if >5%)
- Memory and CPU usage
- Failed deployments

---

## 🚨 Incident Response Plan

### If Credentials Are Compromised

**Immediate Actions (Within 1 hour):**
1. ⚡ Disable/revoke compromised credentials immediately
2. ⚡ Check service logs for unauthorized access
3. ⚡ Generate and deploy new credentials
4. ⚡ Force push Git cleanup if credentials were in repository

**Investigation (Within 24 hours):**
1. Determine scope of exposure (who had access, when, how long)
2. Check billing/usage for anomalies
3. Review access logs for unauthorized activity
4. Document timeline and impact

**Recovery (Within 48 hours):**
1. Rotate all related credentials
2. Update all environments (dev, staging, prod)
3. Verify all services functioning normally
4. Implement additional safeguards
5. Post-mortem documentation

**Contacts:**
- Google Cloud Support: https://cloud.google.com/support
- Meta Developer Support: https://developers.facebook.com/support
- Upstash Support: support@upstash.com
- Render Support: https://render.com/docs/support

---

## ✅ Security Checklist

### Monthly Tasks
- [ ] Review Google Cloud billing for anomalies
- [ ] Check Upstash Redis usage patterns
- [ ] Verify `.gitignore` is protecting sensitive files
- [ ] Scan repository for accidentally committed secrets
- [ ] Review Render logs for unusual activity

### Quarterly Tasks (Every 90 days)
- [ ] Rotate Google Cloud service account keys
- [ ] Review and update this SECURITY.md document
- [ ] Audit IAM permissions in Google Cloud
- [ ] Review Meta app permissions and tokens
- [ ] Update dependencies and check for vulnerabilities

### Annual Tasks
- [ ] Full security audit of entire infrastructure
- [ ] Review and update incident response plan
- [ ] Penetration testing (if applicable)
- [ ] Security training for team members

---

## 📚 Additional Resources

- [Google Cloud Security Best Practices](https://cloud.google.com/security/best-practices)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)
- [git-secrets Tool](https://github.com/awslabs/git-secrets)
- [BFG Repo Cleaner](https://rtyley.github.io/bfg-repo-cleaner/)

---

## 📝 Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-11-27 | Initial SECURITY.md creation after credential rotation audit | Claude Code |
| 2025-11-27 | Google Cloud Vision credentials rotated | Claude Code |
| 2025-11-27 | Repository cleaned of exposed credentials | Claude Code |

---

**Next Review Date:** 2026-02-27 (90 days)
**Next Key Rotation:** 2026-02-27 (Google Cloud Vision)
