# Production Deployment Checklist ✅

## Pre-Deployment Security

### 🔒 Authentication & Secrets
- [ ] Change admin password from default `admin123`
- [ ] Generate secure SECRET_KEY using `openssl rand -hex 32`
- [ ] Generate secure JWT_SECRET_KEY
- [ ] Set strong database passwords if using external DB
- [ ] Review and update CORS_ORIGINS for your domain only
- [ ] Remove any hardcoded secrets or API keys

### 🛡️ Environment Configuration
- [ ] Copy `.env.example` to `.env` and configure all values
- [ ] Set `LOG_LEVEL=INFO` (not DEBUG)
- [ ] Configure proper database path (not in web directory)
- [ ] Set up SSL certificate and force HTTPS
- [ ] Configure proper storage paths with correct permissions

## Application Setup

### 🏗️ Build Process
- [ ] Run `./build.sh` to create production builds
- [ ] Verify Python virtual environment is created
- [ ] Confirm all dependencies are installed
- [ ] Check that database is initialized with scenarios
- [ ] Test frontend build in `web/dist/`

### 📊 Data & Storage
- [ ] Create storage directories: `raw/`, `processed/`, `exports/`
- [ ] Set proper file permissions (755 for directories, 644 for files)
- [ ] Configure backup strategy for SQLite database
- [ ] Test audio upload and storage functionality
- [ ] Verify admin export functionality works

## Infrastructure & Services

### 🌐 Web Server Configuration
- [ ] Install and configure nginx or apache
- [ ] Set up reverse proxy to FastAPI backend
- [ ] Configure static file serving for React frontend
- [ ] Set proper client_max_body_size for audio uploads
- [ ] Enable gzip compression for static assets

### 🔧 Process Management
- [ ] Install systemd service file (`s2i-recorder.service`)
- [ ] Enable and start the service
- [ ] Test service restart functionality
- [ ] Configure automatic startup on boot
- [ ] Set up log rotation for application logs

### 📈 Monitoring & Health Checks
- [ ] Test `/api/health` endpoint
- [ ] Set up basic monitoring (CPU, memory, disk usage)
- [ ] Configure log aggregation
- [ ] Set up alerts for service failures
- [ ] Test backup and restore procedures

## Security Hardening

### 🔐 Access Control
- [ ] Configure firewall rules (only 80, 443, SSH)
- [ ] Disable unnecessary services
- [ ] Set up fail2ban for SSH protection
- [ ] Review and limit user permissions
- [ ] Enable SELinux or AppArmor if available

### 🌍 Network Security
- [ ] Configure HTTPS with valid SSL certificate
- [ ] Set up HSTS headers
- [ ] Configure proper CSP headers
- [ ] Review and test CORS configuration
- [ ] Disable server version disclosure

## Application Testing

### ✅ Functionality Tests
- [ ] Test speaker onboarding flow
- [ ] Verify audio recording and playback
- [ ] Test domain switching (BNK, EDU, TRV, VAS)
- [ ] Confirm offline functionality works
- [ ] Test admin panel login and features

### 🎯 Admin Panel Tests
- [ ] Login with admin credentials
- [ ] View statistics and coverage data
- [ ] Test audio clip review queue
- [ ] Verify speaker withdrawal functionality
- [ ] Test dataset export feature

### 📱 Cross-Platform Tests
- [ ] Test on Chrome, Firefox, Safari
- [ ] Verify mobile responsiveness
- [ ] Test audio recording on different devices
- [ ] Confirm keyboard shortcuts work (spacebar)
- [ ] Test with slow/unreliable internet

## Performance & Optimization

### ⚡ Performance Tuning
- [ ] Enable static file caching headers
- [ ] Configure CDN for audio files if needed
- [ ] Set up database connection pooling
- [ ] Enable gzip compression
- [ ] Optimize audio file sizes

### 📊 Load Testing
- [ ] Test with multiple concurrent users
- [ ] Verify database performance under load
- [ ] Test audio upload bandwidth limits
- [ ] Monitor memory usage during peak load
- [ ] Test backup/restore under load

## Data Privacy & Compliance

### 🔏 Privacy Protection
- [ ] Verify no PII is stored with audio data
- [ ] Test speaker data anonymization
- [ ] Confirm consent tracking works properly
- [ ] Test complete data deletion on withdrawal
- [ ] Review data retention policies

### 📋 Legal Compliance
- [ ] Update privacy policy and terms of service
- [ ] Ensure GDPR compliance (if applicable)
- [ ] Document data processing procedures
- [ ] Set up audit logging
- [ ] Review speaker consent process

## Documentation & Training

### 📚 Documentation Updates
- [ ] Update README with production URLs
- [ ] Document admin procedures
- [ ] Create troubleshooting guide
- [ ] Update API documentation
- [ ] Create user training materials

### 👥 Team Preparation
- [ ] Train admin users on panel features
- [ ] Document incident response procedures
- [ ] Set up support channels
- [ ] Create deployment runbook
- [ ] Schedule regular maintenance windows

## Post-Deployment

### 🔍 Initial Monitoring (First 24 hours)
- [ ] Monitor error logs closely
- [ ] Check system resource usage
- [ ] Verify all endpoints are responding
- [ ] Test a full end-to-end user flow
- [ ] Monitor database performance

### 📈 Ongoing Operations
- [ ] Set up automated backups
- [ ] Configure monitoring alerts
- [ ] Plan regular security updates
- [ ] Schedule database maintenance
- [ ] Set up usage analytics

## Rollback Plan

### 🚨 Emergency Procedures
- [ ] Document rollback procedure
- [ ] Test service restart process
- [ ] Prepare database backup restoration
- [ ] Set up emergency contact procedures
- [ ] Create status page for downtime communication

---

## Quick Production Start

Once all items above are completed:

```bash
# Final verification
sudo systemctl status s2i-recorder
curl -f http://your-domain.com/api/health
curl -f https://your-domain.com  # Test HTTPS

# Go live!
echo "🚀 S2I Hinglish Recorder is now live at https://your-domain.com"
```

## Support Contacts

- **Technical Issues**: [Your Tech Team Email]
- **Security Issues**: [Your Security Team Email]  
- **Business Issues**: [Your Business Team Email]

---
**Remember**: Always test in a staging environment first! 🧪