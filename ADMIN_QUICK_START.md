# Admin Panel - Quick Start Guide

## 🚀 5-Minute Setup

### 1. Start the Backend
```bash
cd api
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

### 2. Start the Frontend
```bash
cd web
npm run dev
```

### 3. Access Admin Panel
1. Open: **http://localhost:3000**
2. Click: **"Admin Panel"** button (top right)
3. Login:
   - Username: `admin`
   - Password: `admin123`

---

## 🎯 What You Can Do

### 📊 Statistics Dashboard
- View system-wide metrics
- Export CSV dataset manifest
- Download comprehensive Excel report

### 🎧 Listen & Approve Recordings
1. Click **"Recordings"** tab
2. Use search or filter by status
3. Click **Play** to hear the audio
4. Click **Approve** or **Reject**

### 📈 Monitor Coverage
1. Click **"Coverage"** tab
2. See progress bars for each intent
3. Check speaker diversity
4. Identify collection gaps

### 👥 Manage Speakers
1. Click **"Speakers"** tab
2. View detailed statistics per speaker
3. Search by ID, region, or language
4. Withdraw speakers if needed

---

## 📥 Export Data

### CSV Export (Manifest)
- Click **"Download CSV Manifest"** button
- Gets speaker-disjoint train/dev/test splits
- One row per clip with full metadata

### Excel Export (Comprehensive)
- Click **"Download Excel Report"** button
- 4 sheets: Speakers, Recordings, Coverage, QC Summary
- Auto-formatted and professional

---

## 🔍 Search & Filter

### Search Recordings
```
Type in search box:
- Speaker ID: "SPK_0042"
- Domain: "BNK"
- Intent: "block_card"
```

### Filter by Status
```
Dropdown options:
- All
- Confirmed
- Processing
- Processed
- Rejected
- Discarded
```

---

## 🎧 Audio Playback

**Every recording has a built-in audio player!**

1. Navigate to Recordings tab
2. Scroll to any clip card
3. Click the play button
4. Listen to the recording
5. Review and approve/reject

---

## ⚡ Keyboard Shortcuts

- **Spacebar**: Start/Stop recording (volunteer mode)
- **Tab**: Navigate between fields
- **Enter**: Submit forms

---

## 🔒 Security Notes

### Change Default Password!
```python
# File: /api/app/auth.py
ADMIN_USERNAME = "your_username"
ADMIN_PASSWORD = "your_secure_password"
```

### Or use environment variables:
```bash
export ADMIN_USERNAME="your_username"
export ADMIN_PASSWORD="your_secure_password"
```

---

## 📱 Features at a Glance

| Feature | Status |
|---------|--------|
| View all recordings | ✅ |
| Play audio in browser | ✅ |
| Approve/Reject clips | ✅ |
| Search & filter | ✅ |
| Coverage tracking | ✅ |
| Speaker management | ✅ |
| CSV export | ✅ |
| Excel export | ✅ |
| Speaker withdrawal | ✅ |
| Real-time stats | ✅ |

---

## 🐛 Common Issues

### Can't login?
- Check backend is running (port 8000)
- Verify credentials: admin / admin123
- Check browser console for errors

### Audio won't play?
- Ensure clips exist in `/api/storage/`
- Check CORS settings
- Try different browser

### Export button not working?
- Verify openpyxl is installed
- Check `/api/storage/exports/` exists
- Ensure write permissions

---

## 💡 Pro Tips

1. **Use search** - Much faster than scrolling
2. **Filter by status** - Focus on what needs review
3. **Excel export** - Best for comprehensive reports
4. **CSV export** - Best for ML pipelines
5. **Refresh button** - Get latest data anytime

---

## 📞 Need Help?

Check these docs:
- **ADMIN_PANEL_COMPLETE.md** - Full feature documentation
- **ADMIN_PANEL_GUIDE.md** - API and technical details
- **API_CONTRACT.md** - Complete API specification

---

## ✨ You're All Set!

The admin panel is **production-ready** with all features:
- ✅ Audio playback
- ✅ Data export (CSV + Excel)
- ✅ Search & filter
- ✅ Coverage monitoring
- ✅ Speaker management

**Happy managing!** 🎉
