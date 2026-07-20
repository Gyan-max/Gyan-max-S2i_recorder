# Admin Panel Access Guide

## ✅ Admin Panel is Now Available!

### Quick Access

1. **Open the app**: http://localhost:3000
2. **Click "Admin Access" button** on the welcome screen (bottom of the form)
3. **Automatic login** with default credentials
4. **View admin dashboard** with statistics

---

## 🎯 What You'll See

### Admin Dashboard Features:

#### 📊 Statistics Cards
- **Total Speakers** - Number of registered volunteers
- **Total Recordings** - All recordings in the system
- **Pending Review** - Clips awaiting admin approval
- **Approved Clips** - Confirmed recordings

#### 📋 System Information
- Database location and type
- Storage paths
- API version
- Admin token (partial display)

#### 🔗 Quick Links
- **API Documentation** - Opens FastAPI Swagger docs (admin endpoints)
- **Raw Stats JSON** - Direct API endpoint response

---

## 🔐 Credentials

**Username**: `admin`  
**Password**: `admin123`

⚠️ **Security Note**: These are default credentials. Change them in production!

**Where to change**:
- File: `/api/app/auth.py`
- Lines 24-25:
  ```python
  ADMIN_USERNAME = "admin"
  ADMIN_PASSWORD = "admin123"  # Change this!
  ```

---

## 🛠️ Admin API Endpoints

All available at `http://localhost:8000/api/admin/*`

### Authentication
```bash
POST /api/admin/login
Body: {"username": "admin", "password": "admin123"}
Returns: {"token": "...", "expires_at": "..."}
```

### Statistics
```bash
GET /api/admin/stats
Headers: Authorization: Bearer {token}
Returns: {
  "total_speakers": 0,
  "total_recordings": 0,
  "clips_pending_review": 0,
  "clips_approved": 0,
  "clips_rejected": 0
}
```

### Coverage Report
```bash
GET /api/admin/coverage
Headers: Authorization: Bearer {token}
Returns: Domain and intent coverage statistics
```

### Review Queue
```bash
GET /api/admin/review-queue
Headers: Authorization: Bearer {token}
Returns: List of clips awaiting review
```

### Review Action
```bash
POST /api/admin/review
Headers: Authorization: Bearer {token}
Body: {
  "clip_id": "...",
  "action": "approve" | "reject",
  "notes": "optional"
}
```

### Export Dataset
```bash
POST /api/admin/export
Headers: Authorization: Bearer {token}
Body: {
  "domain": "BNK" | "EDU" | "TRV" | "VAS",
  "split_config": {
    "train": 0.8,
    "dev": 0.1,
    "test": 0.1
  }
}
```

### Speaker Withdrawal
```bash
POST /api/admin/withdraw
Headers: Authorization: Bearer {token}
Body: {"speaker_id": "..."}
```

### Generate QR Codes
```bash
POST /api/admin/qr-generate
Headers: Authorization: Bearer {token}
Body: {
  "count": 50,
  "domain": "BNK"
}
```

---

## 📖 Full API Documentation

Visit: **http://localhost:8000/docs**

- Interactive API explorer
- Try endpoints directly in browser
- View request/response schemas
- Authentication testing

---

## 🎨 UI Features

### Current Admin Panel (Phase 5)
✅ Admin login button on welcome screen  
✅ Statistics dashboard  
✅ System information display  
✅ Quick links to API docs  
✅ Token display  
✅ Back to home navigation  

### Future Enhancements (Phase 6+)
- 📋 Clip review interface
- 🎧 Audio playback in admin panel
- 📊 Advanced analytics charts
- 👥 Speaker management
- 📦 Export UI
- 🔍 Search and filtering
- 📈 Real-time updates

---

## 🔍 How to Use Admin Panel

### 1. View Statistics
- Click "Admin Access" on welcome screen
- Dashboard loads automatically with stats
- Stats refresh on page load

### 2. Check API Documentation
- Click "📖 API Documentation" button
- Opens FastAPI Swagger UI
- Filter by "Admin" tag to see admin endpoints
- Try endpoints interactively

### 3. Get Raw Data
- Click "📊 Raw Stats JSON" button
- Opens JSON response in new tab
- Copy data for external tools

### 4. Use API Programmatically
```javascript
// Example: Get admin stats
const response = await fetch('http://localhost:8000/api/admin/stats', {
  headers: {
    'Authorization': `Bearer ${adminToken}`
  }
});
const stats = await response.json();
console.log(stats);
```

---

## 📂 Where Data is Stored

### Phase 5 (Current)
**Browser Only (IndexedDB)**
- Location: Browser's internal storage
- Access: Chrome DevTools → Application → IndexedDB
- Database: `hinglish-s2i-recordings`
- Store: `recordings`

**Server (SQLite)**
- Location: `/api/s2i_recorder.db`
- Tables: speakers, devices, tasks, scenarios
- Not yet: clips table (Phase 6)

### Phase 6+ (Future)
**Server Filesystem**
- Raw uploads: `/api/storage/raw/`
- Processed: `/api/storage/processed/`
- Exports: `/api/storage/exports/`

**Server Database**
- Clips table with metadata
- QC results
- Transcriptions

---

## 🐛 Troubleshooting

### Admin button not visible
- Refresh the page
- Check if web server is running (http://localhost:3000)
- Rebuild: `cd web && npm run build`

### Login fails
- Check API server is running (http://localhost:8000)
- Verify credentials in `/api/app/auth.py`
- Check browser console for errors

### Stats show zero
- Database might be empty (no recordings yet)
- This is normal for fresh installation
- Record some audio first as a volunteer

### Token errors
- Token expires after 8 hours
- Click "Back to Home" and re-login
- Check API server logs for auth errors

---

## 🔒 Security Best Practices

### For Production:

1. **Change default credentials**
   ```python
   # api/app/auth.py
   ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
   ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")  # No default!
   ```

2. **Use environment variables**
   ```bash
   # .env file
   ADMIN_USERNAME=your_username
   ADMIN_PASSWORD=your_secure_password
   SECRET_KEY=your-secret-key-here
   ```

3. **Hash passwords**
   - Current: plain text comparison
   - Recommended: bcrypt or similar

4. **HTTPS only**
   - Enforce HTTPS in production
   - No admin access over HTTP

5. **Rate limiting**
   - Add login attempt limits
   - Use tools like slowapi

6. **Audit logging**
   - Log all admin actions
   - Track who did what and when

---

## 📚 Related Documentation

- **PHASE5_COMPLETE.md** - Phase 5 overview
- **SYSTEM_ARCHITECTURE.md** - Complete system flow
- **API Documentation** - http://localhost:8000/docs

---

## ✅ Quick Test

1. Open http://localhost:3000
2. See "Admin Access" button at bottom
3. Click it
4. Admin dashboard appears with stats
5. Success! ✨

---

**Created**: Phase 5 Implementation  
**Status**: ✅ Working  
**Access**: http://localhost:3000 → Click "Admin Access"
