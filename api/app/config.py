import os

# Security and Auth Environment Variables
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv("ACCESS_TOKEN_EXPIRE_HOURS", "8"))

# CORS Configuration
CORS_ORIGINS = [
    origin.strip() for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001"
    ).split(",") if origin.strip()
]

# Audio Quality Control Settings
QC_MIN_DURATION_S = float(os.getenv("QC_MIN_DURATION_S", "0.8"))
QC_MAX_DURATION_S = float(os.getenv("QC_MAX_DURATION_S", "15.0"))
QC_MIN_SNR_DB = float(os.getenv("QC_MIN_SNR_DB", "12.0"))
