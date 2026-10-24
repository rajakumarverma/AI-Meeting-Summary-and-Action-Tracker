"""Convenience launcher:  python run.py"""
import os

import uvicorn

from backend.config import load_env_file

if __name__ == "__main__":
    load_env_file()
    uvicorn.run("backend.main:app", host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")))
