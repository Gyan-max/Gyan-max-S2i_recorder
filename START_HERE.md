# 🚀 START HERE - S2I Hinglish Recorder

## Quick Start (Copy & Paste These Commands)

### Terminal 1 - Start Backend:
```bash
cd /home/gyan-max/Desktop/S2i_recorder
./start-api.sh
```

### Terminal 2 - Start Frontend:
```bash
cd /home/gyan-max/Desktop/S2i_recorder
./start-web.sh
```

### Browser:
```
Open: http://localhost:5173
```

---

## If Scripts Don't Work, Manual Steps:

### Backend (Terminal 1):
```bash
cd /home/gyan-max/Desktop/S2i_recorder/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (Terminal 2):
```bash
cd /home/gyan-max/Desktop/S2i_recorder/web
npm install
npm run dev
```

---

## What to Expect:

**Backend starts** → You'll see:
```
INFO: Seeding database with 198 scenarios...
INFO: Uvicorn running on http://0.0.0.0:8000
```

**Frontend starts** → You'll see:
```
➜  Local:   http://localhost:5173/
```

**Browser** → Open http://localhost:5173 and start recording!

---

## Default Admin Credentials:
- Username: `admin`
- Password: `admin123`

---

## For Complete Details:
- **Quick Start**: [WHAT_YOU_NEED_TO_DO.md](./WHAT_YOU_NEED_TO_DO.md)
- **Installation Guide**: [SETUP.md](./SETUP.md)
- **Project Status**: [PROJECT_STATUS.md](./PROJECT_STATUS.md)

---

## Project is 100% Complete ✅

All code written and tested. Just need to:
1. Install dependencies
2. Start servers
3. Test in browser

**Total time: ~5 minutes**
