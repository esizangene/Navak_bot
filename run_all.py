import os
import subprocess
import sys
import time

PROGRAMS = ["bot.py", "bale_bot.py", "rubika_bot.py"]
REQUIRED = ["TELEGRAM_BOT_TOKEN", "BALE_BOT_TOKEN", "RUBIKA_BOT_TOKEN"]


def main():
    missing = [key for key in REQUIRED if not os.getenv(key, "").strip()]
    if missing:
        raise SystemExit("Missing environment variables: " + ", ".join(missing))

    processes = [
        subprocess.Popen([sys.executable, program])
        for program in PROGRAMS
    ]
    try:
        while True:
            for program, process in zip(PROGRAMS, processes):
                code = process.poll()
                if code is not None:
                    raise SystemExit(f"{program} stopped with exit code {code}")
            time.sleep(5)
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    main()
